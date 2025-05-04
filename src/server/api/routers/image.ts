import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import cv from "@techstark/opencv-js";
import { createCanvas, Image } from "canvas";
import { createWorker } from "tesseract.js";
import path from "path";

export interface LogAnalysisResult {
  filename: string;
  area_mm2: number;
  centroid_x_mm: number;
  centroid_y_mm: number;
  Ixx_mm4: number;
  section_modulus_mm3: number;
  detected_height_mm: number | null;
  processed_image_data: string; // Base64 encoded image with annotations
}

async function extractHeightFromImage(
  imageBuffer: Buffer,
): Promise<number | null> {
  try {
    // Create a temporary canvas to work with the image
    const img = new Image();
    img.src = imageBuffer;

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");

    ctx.drawImage(img, 0, 0);

    // Convert canvas to data URL for Tesseract
    const dataUrl = canvas.toDataURL("image/png");

    // Recognize text in the image
    const worker = await createWorker("eng", 1, {
      workerPath: './node_modules/tesseract.js/src/worker-script/node/index.js',
      //langPath: './eng.traineddata',
    });
    const result = await worker.recognize(dataUrl);
    const text = result.data.text;

    console.log("OCR Text:", text); // Debug log for OCR text

    // Look for patterns like "342mm" or "342 mm" in the text
    const heightRegex = /(\d+)\s*mm/i;

    const match = text.match(heightRegex);

    console.log("Height match:", match); // Debug log for height match

    if (match && match[1]) {
      const height = parseInt(match[1], 10);
      if (height > 0 && height < 1000) { // Sanity check for reasonable height values
        return height;
      }
    }

    return null;
  } catch (error) {
    console.error("Error extracting height from image:", error);
    return null;
  }
}

async function analyzeLogSection(
  imageBuffer: Buffer,
  realWorldHeightMm: number,
  filename: string,
): Promise<LogAnalysisResult> {
  // Create a canvas to load the image
  const img = new Image();
  img.src = imageBuffer;

  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  // Draw image to canvas
  ctx.drawImage(img, 0, 0);

  // Try to extract height from image text BEFORE any processing
  const detectedHeight = await extractHeightFromImage(imageBuffer);
  console.log(`Detected height for ${filename}:`, detectedHeight);

  // Use detected height if available, otherwise use a default height of 300mm
  const heightToUse = detectedHeight || 300; // Default to 300mm if no height detected
  console.log(`Using height for ${filename}:`, heightToUse);

  // Get image data for processing
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Convert to OpenCV Mat
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Threshold the image
  const binary = new cv.Mat();
  cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.bitwise_not(binary, binary);

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
    binary,
    contours,
    hierarchy,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE,
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
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  cv.drawContours(mask, contours, largestContourIndex, new cv.Scalar(255), -1);

  // Get masked image
  const maskedImage = new cv.Mat();
  cv.bitwise_and(gray, gray, maskedImage, mask);

  // Get bounding rectangle of the shape (excluding text/labels)
  const boundingRect = cv.boundingRect(contours.get(largestContourIndex));
  const shapeHeightPx = boundingRect.height;
  
  console.log(`Shape height in pixels for ${filename}:`, shapeHeightPx);
  
  // Calculate scale based on the actual shape height, not the full image
  const scale = heightToUse / shapeHeightPx;
  const pixelAreaMm2 = scale * scale;

  console.log(`Scale factor for ${filename}:`, scale);
  console.log(`Pixel area in mm² for ${filename}:`, pixelAreaMm2);

  // Calculate moments and properties
  const moments = cv.moments(mask);
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
      if (mask.ucharPtr(y, x)[0] === 255) {
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
  
  // Draw original image
  visualCtx.drawImage(img, 0, 0);
  
  // Remove text/labels by filling the areas outside the main contour with white
  visualCtx.globalCompositeOperation = 'destination-in';
  
  // Create a path for the contour
  visualCtx.beginPath();
  const contour = contours.get(largestContourIndex);
  for (let i = 0; i < contour.data32S.length; i += 2) {
    const x = contour.data32S[i] ?? 0;
    const y = contour.data32S[i + 1] ?? 0;
    if (i === 0) {
      visualCtx.moveTo(x, y);
    } else {
      visualCtx.lineTo(x, y);
    }
  }
  visualCtx.closePath();
  visualCtx.fill();
  
  // Reset composite operation
  visualCtx.globalCompositeOperation = 'source-over';
  
  // Draw centroid with much larger, more visible marker
  visualCtx.fillStyle = '#FF0000'; // Bright red
  visualCtx.beginPath();
  visualCtx.arc(centroidX, centroidY, 15, 0, 2 * Math.PI); // Increased radius from 8 to 15
  visualCtx.fill();
  
  // Add a thicker contrasting border to the centroid
  visualCtx.strokeStyle = '#FFFFFF'; // White border
  visualCtx.lineWidth = 4; // Increased from 2 to 4
  visualCtx.stroke();
  
  // Draw x and y axes through centroid with even higher visibility
  visualCtx.strokeStyle = '#0000FF'; // Bright blue
  visualCtx.lineWidth = 5; // Increased from 3 to 5
  
  // X-axis with dashed line for better visibility
  visualCtx.beginPath();
  visualCtx.setLineDash([15, 7]); // Increased dash size from [10, 5] to [15, 7]
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
  visualCtx.font = 'bold 24px Arial'; // Increased from 16px to 24px
  visualCtx.fillStyle = '#000000';
  visualCtx.strokeStyle = '#FFFFFF';
  visualCtx.lineWidth = 4; // Increased from 3 to 4
  
  // Centroid label
  visualCtx.strokeText('C', centroidX + 18, centroidY - 18); // Moved further from centroid
  visualCtx.fillText('C', centroidX + 18, centroidY - 18);
  
  // Add X and Y labels at the ends of the axes
  visualCtx.strokeText('X', img.width - 30, centroidY - 10);
  visualCtx.fillText('X', img.width - 30, centroidY - 10);
  
  visualCtx.strokeText('Y', centroidX + 10, 30);
  visualCtx.fillText('Y', centroidX + 10, 30);
  
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

  // Return the detected height, not the height used for calculations
  return {
    filename,
    area_mm2: areaMm2,
    centroid_x_mm: centroidXMm,
    centroid_y_mm: centroidYMm,
    Ixx_mm4: IxxMm4,
    section_modulus_mm3: sectionModulusMm3,
    detected_height_mm: detectedHeight, // Return the actual detected height, not the default
    processed_image_data: processedImageData,
  };
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
        logHeightMm: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const results: LogAnalysisResult[] = [];

      for (const image of input.images) {
        // Convert base64 to buffer
        const base64Data = image.data.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        const result = await analyzeLogSection(
          buffer,
          input.logHeightMm,
          image.filename,
        );
        results.push(result);
      }

      return results;
    }),
});
