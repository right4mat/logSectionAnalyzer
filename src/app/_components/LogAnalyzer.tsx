"use client"
import { useState, useRef, useEffect } from 'react';
import cv from '@techstark/opencv-js';

cv.onRuntimeInitialized = () => {
  console.log("OpenCV.js is ready!");
  // You can now use OpenCV functions here
  console.log(cv.getBuildInformation());
};



interface ResultItem {
  filename: string;
  area: number;
  centroid: {
    x: number;
    y: number;
  };
  momentOfInertia: number;
  sectionModulus: number;
}

function LogAnalyzer() {
  const [inputFolder, setInputFolder] = useState<string>('');
  const [outputFolder, setOutputFolder] = useState<string>('');
  const [logHeight, setLogHeight] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [cvLoaded, setCvLoaded] = useState<boolean>(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskedImageRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef = useRef<HTMLImageElement>(null);



 

  const exportToCSV = (data: ResultItem[]) => {
    const headers = ['Filename', 'Area', 'Centroid X', 'Centroid Y', 'Moment of Inertia', 'Section Modulus'];
    const csvContent = [
      headers.join(','),
      ...data.map(row => [
        row.filename,
        row.area,
        row.centroid.x,
        row.centroid.y,
        row.momentOfInertia,
        row.sectionModulus
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'log_analysis_results.csv';
    link.click();
  };

  const handleRunAnalysis = async () => {
    if (!cvLoaded) {
      alert('OpenCV.js is not yet loaded. Please wait a moment and try again.');
      return;
    }
    
    setIsProcessing(true);
    try {
      // Create a file input element to select multiple image files
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = 'image/png,image/jpeg,image/jpg';
      
      // Trigger file selection dialog
      fileInput.click();
      
      // Process selected files
      fileInput.onchange = async (event) => {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        
        if (!files || files.length === 0) {
          setIsProcessing(false);
          return;
        }
        
        const logHeightValue = parseFloat(logHeight);
        
        if (isNaN(logHeightValue) || logHeightValue <= 0) {
          alert('Please enter a valid log height in millimeters.');
          setIsProcessing(false);
          return;
        }
        
        // Set the first image for display
        if (files[0]) {
          setImageUrl(URL.createObjectURL(files[0]));
        }
        
        setIsProcessing(false);
      };
    } catch (error) {
      console.error('Error during analysis:', error);
      setIsProcessing(false);
    }
  };

  const handleImageLoad = () => {
    if (originalImageRef.current && cvLoaded) {
      try {
        const logHeightValue = parseFloat(logHeight);
        if (!isNaN(logHeightValue) && logHeightValue > 0) {
         // const result = processImage(originalImageRef.current, logHeightValue);
          //setResults([result]);
        }
      } catch (error) {
        console.error('Error processing image:', error);
      }
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Log Section Analyzer</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block mb-2">Input Folder:</label>
          <input
            type="text"
            value={inputFolder}
            onChange={(e) => setInputFolder(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Select input folder"
          />
        </div>
        
        <div>
          <label className="block mb-2">Output Folder:</label>
          <input
            type="text"
            value={outputFolder}
            onChange={(e) => setOutputFolder(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Select output folder"
          />
        </div>
        
        <div>
          <label className="block mb-2">Log Height (mm):</label>
          <input
            type="number"
            value={logHeight}
            onChange={(e) => setLogHeight(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Enter log height"
          />
        </div>
        
        <button
          onClick={handleRunAnalysis}
          disabled={isProcessing || !cvLoaded}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {isProcessing ? 'Processing...' : cvLoaded ? 'Run Analysis' : 'Loading OpenCV...'}
        </button>
      </div>
      
      {imageUrl && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="image-card">
            <h3 className="text-xl font-bold mb-2">Original Image</h3>
            <img
              ref={originalImageRef}
              src={imageUrl}
              alt="Original input"
              className="border border-gray-300 bg-white"
              onLoad={handleImageLoad}
            />
          </div>
          
          <div className="image-card">
            <h3 className="text-xl font-bold mb-2">Processed Image</h3>
            <canvas ref={canvasRef} className="border border-gray-300 bg-white"></canvas>
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
                  <th className="border p-2">Area</th>
                  <th className="border p-2">Centroid X</th>
                  <th className="border p-2">Centroid Y</th>
                  <th className="border p-2">Moment of Inertia</th>
                  <th className="border p-2">Section Modulus</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={index}>
                    <td className="border p-2">{result.filename}</td>
                    <td className="border p-2">{result.area.toFixed(2)}</td>
                    <td className="border p-2">{result.centroid.x.toFixed(2)}</td>
                    <td className="border p-2">{result.centroid.y.toFixed(2)}</td>
                    <td className="border p-2">{result.momentOfInertia.toFixed(2)}</td>
                    <td className="border p-2">{result.sectionModulus.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => exportToCSV(results)}
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