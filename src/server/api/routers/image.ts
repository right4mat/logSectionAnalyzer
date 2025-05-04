import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import cv from "@techstark/opencv-js";
import { createCanvas, Image } from "canvas";
import openai from "./_openAI";

// Initialize OpenCV
let opencvReady = false;
cv.onRuntimeInitialized = () => {
  opencvReady = true;
  console.log("OpenCV.js is ready");
};

// Wait for OpenCV to be ready
const waitForOpenCV = () => {
  return new Promise<void>((resolve) => {
    if (opencvReady) {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (opencvReady) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    }
  });
};

export interface LogAnalysisResult {
  filename: string;
  area_mm2: number;
  centroid_x_mm: number;
  centroid_y_mm: number;
  Ixx_mm4: number;
  section_modulus_mm3: number;
  detected_height_mm: number; // Height in millimeters that was used for calculations
  processed_image_data: string; // Base64 encoded image with annotations
}

interface Moments {
  m00: number;
  m10: number;
  m01: number;
}

async function analyzeLogSection(
  imageBuffer: Buffer,
  heightMm: number,
  filename: string,
): Promise<LogAnalysisResult> {
  // Wait for OpenCV to be ready
  await waitForOpenCV();

  try {
    // Create a canvas to load the image
    const img = new Image();
    img.src = imageBuffer;

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");

    // Draw image to canvas
    ctx.drawImage(img, 0, 0);

    // Get image data for processing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Convert to OpenCV Mat
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY as number);

    // Threshold the image
    const binary = new cv.Mat();
    cv.threshold(gray, binary, 0, 255, (cv.THRESH_BINARY + cv.THRESH_OTSU) as number);
    cv.bitwise_not(binary, binary);

    // Find contours
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL as number,
      cv.CHAIN_APPROX_SIMPLE as number,
    );

    // Find largest contour
    let maxArea = 0;
    let largestContourIndex = 0;
    for (let i = 0; i < contours.size(); i++) {
      const area = cv.contourArea(contours.get(i));
      if (area > maxArea) {
        maxArea = area;
        largestContourIndex = i;
      }
    }

    console.log(`Largest contour area for ${filename}:`, maxArea);

    if (maxArea === 0) {
      throw new Error(`No valid contour found in image ${filename}`);
    }

    // Create mask
    const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1 as number);
    cv.drawContours(mask, contours, largestContourIndex, new cv.Scalar(255), -1);

    // Get masked image
    const maskedImage = new cv.Mat();
    cv.bitwise_and(gray, gray, maskedImage, mask);

    // Get bounding rectangle of the shape (excluding text/labels)
    const boundingRect = cv.boundingRect(contours.get(largestContourIndex));
    const shapeHeightPx = boundingRect.height;
    
    console.log(`Shape height in pixels for ${filename}:`, shapeHeightPx);
    
    // Calculate scale based on the actual shape height, not the full image
    const scale = heightMm / shapeHeightPx;
    const pixelAreaMm2 = scale * scale;

    console.log(`Scale factor for ${filename}:`, scale);
    console.log(`Pixel area in mm² for ${filename}:`, pixelAreaMm2);

    // Calculate moments and properties
    const moments = cv.moments(mask) as Moments;
    const areaMm2 = moments.m00 * pixelAreaMm2;
    const centroidX = moments.m10 / moments.m00;
    const centroidY = moments.m01 / moments.m00;

    console.log(`Raw moments for ${filename}:`, {
      m00: moments.m00,
      m10: moments.m10,
      m01: moments.m01
    });

    // Convert to real-world coordinates
    const centroidXMm = centroidX * scale;
    const centroidYMm = centroidY * scale;

    console.log(`Centroid coordinates for ${filename}:`, {
      x: centroidXMm,
      y: centroidYMm
    });

    // Calculate Ixx (moment of inertia)
    let IxxMm4 = 0;
    for (let y = 0; y < mask.rows; y++) {
      for (let x = 0; x < mask.cols; x++) {
        const pixelValue = mask.ucharPtr(y, x) as Uint8Array;
        if (pixelValue?.[0] === 255) {
          const yMm = y * scale;
          IxxMm4 += Math.pow(yMm - centroidYMm, 2) * pixelAreaMm2;
        }
      }
    }

    console.log(`Ixx for ${filename}:`, IxxMm4);

    // Calculate section modulus using the shape's bounding box
    const maxY = (boundingRect.y + boundingRect.height) * scale;
    const minY = boundingRect.y * scale;
    const cMm = Math.max(maxY - centroidYMm, centroidYMm - minY);
    const sectionModulusMm3 = IxxMm4 / cMm;

    console.log(`Section modulus for ${filename}:`, sectionModulusMm3);

    // Create a visualization with the log section and annotations
    const visualCanvas = createCanvas(img.width, img.height);
    const visualCtx = visualCanvas.getContext('2d');
    if (!visualCtx) throw new Error("Failed to get visual canvas context");
    
    // Draw original image
    visualCtx.drawImage(img, 0, 0);
    
    // Remove text/labels by filling the areas outside the main contour with white
    visualCtx.globalCompositeOperation = 'destination-in';
    
    // Create a path for the contour
    visualCtx.beginPath();
    const contour = contours.get(largestContourIndex);
    for (let i = 0; i < contour.data32S.length; i += 2) {
      const x = contour.data32S[i];
      const y = contour.data32S[i + 1];
      if (x !== undefined && y !== undefined) {
        if (i === 0) {
          visualCtx.moveTo(x, y);
        } else {
          visualCtx.lineTo(x, y);
        }
      }
    }
    visualCtx.closePath();
    visualCtx.fill();
    
    // Reset composite operation
    visualCtx.globalCompositeOperation = 'source-over';
    
    // Draw centroid with much larger, more visible marker
    visualCtx.fillStyle = '#FF0000'; // Bright red
    visualCtx.beginPath();
    visualCtx.arc(centroidX, centroidY, 15, 0, 2 * Math.PI);
    visualCtx.fill();
    
    // Add a thicker contrasting border to the centroid
    visualCtx.strokeStyle = '#FFFFFF'; // White border
    visualCtx.lineWidth = 4;
    visualCtx.stroke();
    
    // Draw x and y axes through centroid with even higher visibility
    visualCtx.strokeStyle = '#0000FF'; // Bright blue
    visualCtx.lineWidth = 5;
    
    // X-axis with dashed line for better visibility
    visualCtx.beginPath();
    visualCtx.setLineDash([15, 7]);
    visualCtx.moveTo(0, centroidY);
    visualCtx.lineTo(img.width, centroidY);
    visualCtx.stroke();
    
    // Y-axis with dashed line
    visualCtx.beginPath();
    visualCtx.moveTo(centroidX, 0);
    visualCtx.lineTo(centroidX, img.height);
    visualCtx.stroke();
    
    // Reset line dash
    visualCtx.setLineDash([]);
    
    // Add larger labels for clarity
    visualCtx.font = 'bold 24px Arial';
    visualCtx.fillStyle = '#000000';
    visualCtx.strokeStyle = '#FFFFFF';
    visualCtx.lineWidth = 4;
    
    // Centroid label
    const centroidXNum = Number(centroidX);
    const centroidYNum = Number(centroidY);
    visualCtx.strokeText('C', centroidXNum + 18, centroidYNum - 18);
    visualCtx.fillText('C', centroidXNum + 18, centroidYNum - 18);
    
    // Add X and Y labels at the ends of the axes
    visualCtx.strokeText('X', img.width - 30, centroidYNum - 10);
    visualCtx.fillText('X', img.width - 30, centroidYNum - 10);
    
    visualCtx.strokeText('Y', centroidXNum + 10, 30);
    visualCtx.fillText('Y', centroidXNum + 10, 30);
    
    // Get the processed image as base64
    const processedImageData = visualCanvas.toDataURL('image/png');

    // Clean up OpenCV objects
    src.delete();
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
    mask.delete();
    maskedImage.delete();

    return {
      filename,
      area_mm2: areaMm2,
      centroid_x_mm: centroidXMm,
      centroid_y_mm: centroidYMm,
      Ixx_mm4: IxxMm4,
      section_modulus_mm3: sectionModulusMm3,
      detected_height_mm: heightMm, // Return the height that was used for calculations
      processed_image_data: processedImageData,
    };
  } catch (error) {
    console.error("Error in analyzeLogSection:", error);
    throw new Error(`Failed to analyze image ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function extractHeightWithOpenAI(imageData: string): Promise<number> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "This image contains a log section with a height measurement in millimeters. Extract ONLY the height value in millimeters. Return ONLY the number, nothing else."
            },
            {
              type: "image_url",
              image_url: {
                url: imageData
              }
            }
          ]
        }
      ],
      max_tokens: 10
    });

    const heightText = response.choices[0]?.message?.content?.trim();
    if (!heightText) {
      throw new Error("No height value found in the image");
    }

    const height = parseInt(heightText, 10);
    if (isNaN(height) || height <= 0 || height > 1000) {
      throw new Error("Invalid height value detected");
    }

    return height;
  } catch (error) {
    console.error("Error extracting height with OpenAI:", error);
    throw new Error(`Failed to extract height from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export const imageRouter = createTRPCRouter({
  analyze: publicProcedure
    .input(
      z.object({
        images: z.array(
          z.object({
            data: z.string(), // Base64 encoded image data
            filename: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // Wait for OpenCV to be ready before processing any images
        await waitForOpenCV();

        const results: LogAnalysisResult[] = [];

        for (const image of input.images) {
          // Extract height using OpenAI
          const heightMm = await extractHeightWithOpenAI(image.data);

          // Convert base64 to buffer
          const base64Data = image.data.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");

          const result = await analyzeLogSection(
            buffer,
            heightMm,
            image.filename,
          );
          results.push(result);
        }

        return results;
      } catch (error) {
        console.error("Error in analyze mutation:", error);
        throw new Error(`Failed to analyze images: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }),
});
