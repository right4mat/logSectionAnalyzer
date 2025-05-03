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

    // Look for patterns like "342mm" or "342 mm" in the text
    const heightRegex = /(\d+)\s*mm/i;

    const match = text.match(heightRegex);

    console.log(match);

    if (match && match[1]) {
      return parseInt(match[1], 10);
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
  // Try to extract height from image text
  const detectedHeight = await extractHeightFromImage(imageBuffer);

  // Use detected height if available, otherwise use provided height
  const heightToUse = detectedHeight || realWorldHeightMm;

  // Create a canvas to load the image
  const img = new Image();
  img.src = imageBuffer;

  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  // Draw image to canvas
  ctx.drawImage(img, 0, 0);

  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Convert to OpenCV Mat
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Calculate scale
  const heightPx = gray.rows;
  const scale = heightToUse / heightPx;
  const pixelAreaMm2 = scale * scale;

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

  // Create mask
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  cv.drawContours(mask, contours, largestContourIndex, new cv.Scalar(255), -1);

  // Get masked image
  const maskedImage = new cv.Mat();
  cv.bitwise_and(gray, gray, maskedImage, mask);

  // Calculate moments and properties
  const moments = cv.moments(mask);
  const areaMm2 = moments.m00 * pixelAreaMm2;
  const centroidX = moments.m10 / moments.m00;
  const centroidY = moments.m01 / moments.m00;

  // Convert to real-world coordinates
  const centroidXMm = centroidX * scale;
  const centroidYMm = centroidY * scale;

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

  // Calculate section modulus
  const maxY = mask.rows * scale;
  const minY = 0;
  const cMm = Math.max(maxY - centroidYMm, centroidYMm - minY);
  const sectionModulusMm3 = IxxMm4 / cMm;

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
    detected_height_mm: detectedHeight,
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
