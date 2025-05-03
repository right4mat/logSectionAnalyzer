"use client"
import { useState, useRef, useCallback } from 'react';
import { type LogAnalysisResult } from '~/server/api/routers/image';
import { api } from '~/trpc/react';

function LogAnalyzer() {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<LogAnalysisResult[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const originalImageRef = useRef<HTMLImageElement>(null);

  const createCsvMutation = api.csv["create-csv"].useMutation();
  const analyzeImagesMutation = api.image.analyze.useMutation();

  const imagesPerPage = 8; // 2 rows of 4 images
  const totalPages = Math.ceil(imageUrls.length / imagesPerPage);
  
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
        setIsProcessing(false);
      };
    } catch (error) {
      console.error('Error during analysis:', error);
      setIsProcessing(false);
    }
  };

  const handleExportToCSV = async () => {
    try {
      const csvData = results.map(result => ({
        filename: result.filename,
        area_mm2: result.area_mm2.toFixed(2),
        centroid_x_mm: result.centroid_x_mm.toFixed(2),
        centroid_y_mm: result.centroid_y_mm.toFixed(2),
        Ixx_mm4: result.Ixx_mm4.toFixed(2),
        section_modulus_mm3: result.section_modulus_mm3.toFixed(2),
        detected_height_mm: result.detected_height_mm?.toFixed(2) || 'N/A'
      }));

      const response = await createCsvMutation.mutateAsync({
        data: csvData,
        filename: 'log_analysis_results.csv'
      });

      // Create and trigger download
      const blob = new Blob([response.content], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = response.filename;
      link.click();
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      alert('Failed to export results to CSV');
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
          {isProcessing ? 'Processing...' : 'Upload Images'}
        </button>
      </div>
      
      {imageUrls.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xl font-bold mb-2">Uploaded Images</h3>
          <div className="relative">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {imageUrls
                .slice(currentPage * imagesPerPage, (currentPage + 1) * imagesPerPage)
                .map((url, index) => {
                  const actualIndex = currentPage * imagesPerPage + index;
                  const result = results[actualIndex];
                  return (
                    <div key={actualIndex} className="border border-gray-300 rounded overflow-hidden bg-white h-50 w-50">
                      <img
                        src={url}
                        alt={`Uploaded image ${actualIndex + 1}`}
                        className="w-full h-48 object-contain"
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
            onClick={handleExportToCSV}
            className="mt-4 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Export to CSV
          </button>
        </div>
      )}
    </div>
  );
}

export default LogAnalyzer;