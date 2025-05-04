"use client"
import { useState, useRef, useCallback, useEffect } from 'react';
import { type LogAnalysisResult } from '~/server/api/routers/image';
import { api } from '~/trpc/react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

function LogAnalyzer() {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<LogAnalysisResult[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [processedImageUrls, setProcessedImageUrls] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [loadingDots, setLoadingDots] = useState<string>("...");
  const originalImageRef = useRef<HTMLImageElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dotsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [pulseEffect, setPulseEffect] = useState<boolean>(false);

  const createCsvMutation = api.csv["create-csv"].useMutation();
  const analyzeImagesMutation = api.image.analyze.useMutation();

  const imagesPerPage = 8; // 2 rows of 4 images
  const totalPages = Math.ceil(imageUrls.length / imagesPerPage);
  
  // Loading dots animation
  useEffect(() => {
    if (isProcessing) {
      const dotPatterns = [".", "..", "..."];
      let index = 0;
      
      dotsIntervalRef.current = setInterval(() => {
        setLoadingDots(dotPatterns[index]!);
        index = (index + 1) % dotPatterns.length;
      }, 300);

      // Add pulse effect while processing
      const pulseInterval = setInterval(() => {
        setPulseEffect(prev => !prev);
      }, 1000);

      return () => {
        clearInterval(dotsIntervalRef.current!);
        clearInterval(pulseInterval);
      };
    } else {
      setPulseEffect(false);
      if (dotsIntervalRef.current) {
        clearInterval(dotsIntervalRef.current);
      }
    }
    
    return () => {
      if (dotsIntervalRef.current) {
        clearInterval(dotsIntervalRef.current);
      }
    };
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
    setIsProcessing(true);
    try {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = 'image/png,image/jpeg,image/jpg';
      
      fileInput.click();
      
      fileInput.onchange = async (event) => {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        
        if (!files || files.length === 0) {
          setIsProcessing(false);
          return;
        }

        // Clear existing state when new images are uploaded
        setResults([]);
        setProcessedImageUrls([]);

        // Create object URLs for all uploaded images
        const urls = Array.from(files).map(file => URL.createObjectURL(file));
        setImageUrls(urls);
        setCurrentPage(0); // Reset to first page when new images are loaded

        // Convert files to base64
        const imagePromises = Array.from(files).map(file => {
          return new Promise<{ data: string; filename: string }>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve({
                data: reader.result as string,
                filename: file.name
              });
            };
            reader.readAsDataURL(file);
          });
        });

        const images = await Promise.all(imagePromises);
        
        const analysisResults = await analyzeImagesMutation.mutateAsync({
          images,
          logHeightMm: 0 // This will be ignored as we're using detected height
        });

        setResults(analysisResults);
        // Set processed image URLs
        setProcessedImageUrls(analysisResults.map(result => result.processed_image_data));
        setIsProcessing(false);
      };
    } catch (error) {
      console.error('Error during analysis:', error);
      setIsProcessing(false);
    }
  };

  const handleExportToExcel = async () => {
    try {
      // Create a new workbook
      const workbook = new ExcelJS.Workbook();
      
      // Add a main worksheet for results
      const worksheet = workbook.addWorksheet('Log Analysis Results');
      
      // Add headers
      worksheet.columns = [
        { header: 'Filename', key: 'filename', width: 20 },
        { header: 'Area (mm²)', key: 'area_mm2', width: 15 },
        { header: 'Centroid X (mm)', key: 'centroid_x_mm', width: 15 },
        { header: 'Centroid Y (mm)', key: 'centroid_y_mm', width: 15 },
        { header: 'Ixx (mm⁴)', key: 'Ixx_mm4', width: 15 },
        { header: 'Section Modulus (mm³)', key: 'section_modulus_mm3', width: 20 },
        { header: 'Detected Height (mm)', key: 'detected_height_mm', width: 20 }
      ];
      
      // Add data rows
      results.forEach(result => {
        worksheet.addRow({
          filename: result.filename,
          area_mm2: Number(result.area_mm2.toFixed(2)),
          centroid_x_mm: Number(result.centroid_x_mm.toFixed(2)),
          centroid_y_mm: Number(result.centroid_y_mm.toFixed(2)),
          Ixx_mm4: Number(result.Ixx_mm4.toFixed(2)),
          section_modulus_mm3: Number(result.section_modulus_mm3.toFixed(2)),
          detected_height_mm: result.detected_height_mm ? Number(result.detected_height_mm.toFixed(2)) : 'N/A'
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
          imgWorksheet.getCell('A1').value = `Processed Image: ${result.filename}`;
          imgWorksheet.getCell('A1').font = { bold: true, size: 14 };
          
          // Add the image
          const imageId = workbook.addImage({
            base64: result.processed_image_data,
            extension: 'png',
          });
          
          // Add the image to the worksheet
          imgWorksheet.addImage(imageId, {
            tl: { col: 1, row: 2 },
            ext: { width: 600, height: 400 }
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
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, 'log_analysis_results.xlsx');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('Failed to export results to Excel');
    }
  };

  return (
    <div className="p-4">
      <div className="space-y-4 flex flex-col items-center">
        <button
          onClick={handleRunAnalysis}
          disabled={isProcessing}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {isProcessing ? (
            <span className="flex items-center">
              Processing
              <svg className="animate-spin ml-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </span>
          ) : 'Upload Images'}
        </button>
        
      
      </div>
      
      {imageUrls.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xl font-bold mb-2">Processed Images</h3>
          <div className="relative">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {imageUrls
                .slice(currentPage * imagesPerPage, (currentPage + 1) * imagesPerPage)
                .map((url, index) => {
                  const actualIndex = currentPage * imagesPerPage + index;
                  const result = results[actualIndex];
                  const processedUrl = processedImageUrls[actualIndex];
                  return (
                    <div key={actualIndex} className="border border-gray-300 rounded overflow-hidden bg-white h-50 w-50">
                      <img
                        src={processedUrl || url}
                        alt={`Processed image ${actualIndex + 1}`}
                        className={`w-full h-48 object-contain ${isProcessing ? `transition-all duration-500 ${pulseEffect ? 'blur-sm' : 'blur-none'}` : ''}`}
                      />
                      <div className="p-2 bg-gray-50 text-sm">
                        <div className="truncate">{result?.filename || `Image ${actualIndex + 1}`}</div>
                        {result?.detected_height_mm && (
                          <div className="text-xs text-gray-600">
                            Detected height: {result.detected_height_mm}mm
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
            {totalPages > 1 && (
              <div className="flex justify-between mt-4">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 0}
                  className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  Previous
                </button>
                <span className="self-center">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages - 1}
                  className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
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
          <h3 className="text-xl font-bold mb-2">Results</h3>
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
                    <td className="border p-2">{result.detected_height_mm?.toFixed(2) || 'N/A'}</td>
                    <td className="border p-2">{result.area_mm2.toFixed(2)}</td>
                    <td className="border p-2">{result.centroid_x_mm.toFixed(2)}</td>
                    <td className="border p-2">{result.centroid_y_mm.toFixed(2)}</td>
                    <td className="border p-2">{result.Ixx_mm4.toFixed(2)}</td>
                    <td className="border p-2">{result.section_modulus_mm3.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={handleExportToExcel}
            className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Export to Excel
          </button>
        </div>
      )}
    </div>
  );
}

export default LogAnalyzer;