"use client"
import { useState } from 'react';
import cv from '@techstark/opencv-js';

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
    setIsProcessing(true);
    try {
      const analysisResults: ResultItem[] = [];
      // Process each image in the input folder
      // Note: In a real implementation, you would need to use the File System API
      // or a backend service to handle file operations
      
      setResults(analysisResults);
      exportToCSV(analysisResults);
    } catch (error) {
      console.error('Error during analysis:', error);
    } finally {
      setIsProcessing(false);
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
          disabled={isProcessing}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {isProcessing ? 'Processing...' : 'Run Analysis'}
        </button>
      </div>
      
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
        </div>
      )}
    </div>
  );
}

export default LogAnalyzer;