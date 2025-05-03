import cv from '@techstark/opencv-js';

export interface LogAnalysisResult {
  filename: string;
  area_mm2: number;
  centroid_x_mm: number;
  centroid_y_mm: number;
  Ixx_mm4: number;
  section_modulus_mm3: number;
}

export async function analyzeLogSection(
  imageData: ImageData,
  realWorldHeightMm: number,
  filename: string
): Promise<LogAnalysisResult> {
  // Convert ImageData to OpenCV Mat
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Calculate scale
  const heightPx = gray.rows;
  const scale = realWorldHeightMm / heightPx;
  const pixelAreaMm2 = scale * scale;

  // Threshold the image
  const binary = new cv.Mat();
  cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.bitwise_not(binary, binary);

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

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
    section_modulus_mm3: sectionModulusMm3
  };
}

export async function processImages(
  files: File[],
  realWorldHeightMm: number
): Promise<LogAnalysisResult[]> {
  const results: LogAnalysisResult[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;

    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const result = await analyzeLogSection(imageData, realWorldHeightMm, file.name);
    results.push(result);
  }

  return results;
} 