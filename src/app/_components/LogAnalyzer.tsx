"use client";
import { useState, useCallback, useEffect } from "react";
import { type LogAnalysisResult } from "~/server/api/routers/image";
import { api } from "~/trpc/react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import Image from "next/image";
import { createWorker } from "tesseract.js";

function LogAnalyzer() {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<LogAnalysisResult[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [processedImageUrls, setProcessedImageUrls] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [pulseEffect, setPulseEffect] = useState<boolean>(false);
  const [processedIndices, setProcessedIndices] = useState<Set<number>>(new Set());

  const analyzeImagesMutation = api.image.analyze.useMutation();

  const BATCH_SIZE = 1; // Process 1 image at a time
  const CONCURRENT_BATCHES = 3; // Process 2 batches concurrently
  const imagesPerPage = 12; // 3 rows of 4 images
  const totalPages = Math.ceil(imageUrls.length / imagesPerPage);

  // Extract height from image using OCR
  const extractHeightFromImage = async (imageData: string): Promise<number | null> => {
    try {
      const worker = await createWorker("eng");
      const result = await worker.recognize(imageData);
      const text = result.data.text;
      await worker.terminate();

      console.log("OCR Text:", text);

      // Look for patterns like "342mm" or "342 mm" in the text
      const heightRegex = /(\d+)\s*mm/i;
      const match = heightRegex.exec(text);

      console.log("Height match:", match);

      if (match?.[1]) {
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
  };

  // Process a single batch of images
  const processImageBatch = async (
    imageBatch: { data: string; filename: string }[],
  ) => {
    if (!imageBatch) return [];

    // Extract heights for all images in the batch
    const imagesWithHeights = await Promise.all(
      imageBatch.map(async (image) => {
        const height = await extractHeightFromImage(image.data);
        if (!height) {
          throw new Error(`Could not detect height in image ${image.filename}. Please ensure the height is clearly visible in the image.`);
        }
        return {
          ...image,
          heightMm: height,
        };
      })
    );

    const results = await analyzeImagesMutation.mutateAsync({
      images: imagesWithHeights,
    });
    return results;
  };

  // Loading dots animation
  useEffect(() => {
    if (isProcessing) {
      const pulseInterval = setInterval(() => {
        setPulseEffect((prev) => !prev);
      }, 1000);

      return () => {
        clearInterval(pulseInterval);
      };
    } else {
      setPulseEffect(false);
    }
  }, [isProcessing]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
    }
  }, [currentPage, totalPages]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage]);

  const handleRunAnalysis = async () => {
    try {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.accept = "image/png,image/jpeg,image/jpg";

      fileInput.click();

      fileInput.onchange = async (event) => {
        const target = event.target as HTMLInputElement;
        const files = target.files;

        if (!files || files.length === 0) {
          return;
        }

        // Clear existing state when new images are uploaded
        setResults([]);
        setProcessedImageUrls([]);

        // Create object URLs for all uploaded images
        const urls = Array.from(files).map((file) => URL.createObjectURL(file));
        setImageUrls(urls);
        setCurrentPage(0); // Reset to first page when new images are loaded

        // Convert files to base64
        const allImages = await Promise.all(
          Array.from(files).map((file) => {
            return new Promise<{ data: string; filename: string }>(
              (resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  resolve({
                    data: reader.result as string,
                    filename: file.name,
                  });
                };
                reader.readAsDataURL(file);
              },
            );
          }),
        );

        // Split images into batches of BATCH_SIZE
        const batches = [];
        for (let i = 0; i < allImages.length; i += BATCH_SIZE) {
          batches.push(allImages.slice(i, i + BATCH_SIZE));
        }

        // Start processing - set isProcessing to true
        setIsProcessing(true);
        setProcessingProgress(0);
        setProcessedIndices(new Set());

        // Process batches in pairs and update progress
        const allResults: LogAnalysisResult[] = [];
        for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
          const batchPromises = [];
          for (let j = 0; j < CONCURRENT_BATCHES; j++) {
            const batch = batches[i + j];
            if (batch) {
              batchPromises.push(processImageBatch(batch));
            }
          }

          try {
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(results => {
              if (results.length > 0) {
                allResults.push(...results);
              }
            });

            // Update progress only if there are multiple batches
            if (batches.length > 1) {
              const progress = ((i + CONCURRENT_BATCHES) / batches.length) * 100;
              setProcessingProgress(Math.min(progress, 100));
            }

            // Update results and processed images incrementally
            setResults(allResults);
            setProcessedImageUrls(
              allResults.map((result) => result.processed_image_data),
            );

            // Mark the batches' images as processed
            const startIdx = i * BATCH_SIZE;
            const endIdx = Math.min(startIdx + (BATCH_SIZE * CONCURRENT_BATCHES), allImages.length);
            setProcessedIndices((prev) => {
              const newSet = new Set(prev);
              for (let j = startIdx; j < endIdx; j++) {
                newSet.add(j);
              }
              return newSet;
            });
          } catch (error) {
            console.error("Error processing batch:", error);
            alert(`Error processing images: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setIsProcessing(false);
            return;
          }
        }

        setIsProcessing(false);
        setProcessingProgress(100);
      };
    } catch (error) {
      console.error("Error during analysis:", error);
      setIsProcessing(false);
    }
  };

  const handleExportToExcel = async () => {
    try {
      // Create a new workbook
      const workbook = new ExcelJS.Workbook();

      // Add a main worksheet for results
      const worksheet = workbook.addWorksheet("Log Analysis Results");

      // Add headers
      worksheet.columns = [
        { header: "Filename", key: "filename", width: 20 },
        { header: "Area (mm²)", key: "area_mm2", width: 15 },
        { header: "Centroid X (mm)", key: "centroid_x_mm", width: 15 },
        { header: "Centroid Y (mm)", key: "centroid_y_mm", width: 15 },
        { header: "Ixx (mm⁴)", key: "Ixx_mm4", width: 15 },
        {
          header: "Section Modulus (mm³)",
          key: "section_modulus_mm3",
          width: 20,
        },
      ];

      // Add data rows
      results.forEach((result) => {
        worksheet.addRow({
          filename: result.filename,
          area_mm2: Number(result.area_mm2.toFixed(2)),
          centroid_x_mm: Number(result.centroid_x_mm.toFixed(2)),
          centroid_y_mm: Number(result.centroid_y_mm.toFixed(2)),
          Ixx_mm4: Number(result.Ixx_mm4.toFixed(2)),
          section_modulus_mm3: Number(result.section_modulus_mm3.toFixed(2)),
        });
      });

      // Style the header row
      worksheet.getRow(1).font = { bold: true };

      // Add a separate worksheet for each image
      results.forEach((result, index) => {
        if (result.processed_image_data) {
          // Create a worksheet for the image
          const imgWorksheet = workbook.addWorksheet(`Image_${index + 1}`);

          // Add a title
          imgWorksheet.getCell("A1").value =
            `Processed Image: ${result.filename}`;
          imgWorksheet.getCell("A1").font = { bold: true, size: 14 };

          // Add the image
          const imageId = workbook.addImage({
            base64: result.processed_image_data,
            extension: "png",
          });

          // Add the image to the worksheet
          imgWorksheet.addImage(imageId, {
            tl: { col: 1, row: 2 },
            ext: { width: 600, height: 400 },
          });

          // Set column widths
          imgWorksheet.getColumn(1).width = 80;

          // Set row heights
          imgWorksheet.getRow(2).height = 30;
          imgWorksheet.getRow(3).height = 400;
        }
      });

      // Generate Excel file and trigger download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveAs(blob, "log_analysis_results.xlsx");
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Failed to export results to Excel");
    }
  };

  return (
    <div className="p-4">
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className="flex flex-row items-center justify-center space-x-4">
          <button
            onClick={handleRunAnalysis}
            disabled={isProcessing}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-gray-400"
          >
            {isProcessing ? (
              <span className="flex items-center">
                Processing{imageUrls.length > BATCH_SIZE ? ` ${processingProgress.toFixed(0)}%` : ''}
                <svg
                  className="ml-2 h-4 w-4 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </span>
            ) : (
              "Upload Images"
            )}
          </button>
          {!isProcessing && results.length > 0 && (
            <button
              onClick={handleExportToExcel}
              className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
            >
              Export to Excel
            </button>
          )}
        </div>

        {!isProcessing && results.length === 0 && (
          <div className="fixed right-0 bottom-20 left-0 mx-auto mb-6 max-w-2xl rounded-lg p-4 text-sm">
            <h4 className="mb-2 text-center font-bold">
              Important Image Requirements:
            </h4>
            <ul className="flex list-disc flex-col items-center justify-center space-y-2">
              <li>
                Each image must include the log section height in millimeters
                (mm)
              </li>
              <li>
                The height measurement should be clearly visible and readable
              </li>
              <li>
                Keep height measurements and other annotations outside the log
                section area
              </li>
              <li>
                Avoid placing any text or measurements on top of the log section
              </li>
            </ul>
          </div>
        )}
      </div>

      {imageUrls.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xl font-bold">Processed Images</h3>
          <div className="relative">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              {imageUrls
                .slice(
                  currentPage * imagesPerPage,
                  (currentPage + 1) * imagesPerPage,
                )
                .map((url, index) => {
                  const actualIndex = currentPage * imagesPerPage + index;
                  const processedUrl = processedImageUrls[actualIndex];
                  const isProcessed = processedIndices.has(actualIndex);
                  return (
                    <div
                      key={actualIndex}
                      className="aspect-square w-full overflow-hidden rounded border border-gray-300 bg-white"
                    >
                      <Image
                        src={processedUrl ?? url}
                        alt={`Processed image ${actualIndex + 1}`}
                        width={400}
                        height={400}
                        className={`h-full w-full object-contain ${isProcessing && !isProcessed ? `blur-[4px] transition-all duration-500 ${pulseEffect ? "blur-[6px]" : "blur-[4px]"}` : ""}`}
                      />
                    </div>
                  );
                })}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex justify-between">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 0}
                  className="rounded bg-gray-200 px-4 py-2 text-black hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  Previous
                </button>
                <span className="self-center">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages - 1}
                  className="rounded bg-gray-200 px-4 py-2 text-black hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xl font-bold">Results</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border">
              <thead>
                <tr>
                  <th className="border p-2">Filename</th>
                  <th className="border p-2">Height (mm)</th>
                  <th className="border p-2">Area (mm²)</th>
                  <th className="border p-2">Centroid X (mm)</th>
                  <th className="border p-2">Centroid Y (mm)</th>
                  <th className="border p-2">Ixx (mm⁴)</th>
                  <th className="border p-2">Section Modulus (mm³)</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={index}>
                    <td className="border p-2">{result.filename}</td>
                    <td className="border p-2">
                      {result.detected_height_mm?.toFixed(2) ?? "N/A"}
                    </td>
                    <td className="border p-2">{result.area_mm2.toFixed(2)}</td>
                    <td className="border p-2">
                      {result.centroid_x_mm.toFixed(2)}
                    </td>
                    <td className="border p-2">
                      {result.centroid_y_mm.toFixed(2)}
                    </td>
                    <td className="border p-2">{result.Ixx_mm4.toFixed(2)}</td>
                    <td className="border p-2">
                      {result.section_modulus_mm3.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default LogAnalyzer;
