# Log Section Analyzer

A web-based tool built for my father for analyzing geometric properties of log cross-sections from images. This application processes black-and-white images of log sections and automatically extracts key geometric measurements and properties.

## Features

- **Automatic Height Detection**: Extracts height measurements from images using OCR
- **Geometric Analysis**: Calculates key properties including:
  - Centroid coordinates (X, Y)
  - Cross-sectional area
  - Moment of inertia (Ixx)
  - Section modulus
- **Image Processing**: 
  - Removes text and labels from processed images
  - Highlights centroid location
  - Shows coordinate axes
- **Excel Export**: Generates detailed Excel reports with:
  - All computed properties
  - Processed images with annotations
  - Formatted data tables

## Image Requirements

For optimal results, ensure your images meet these criteria:

- Include the log section height in millimeters (mm)
- Height measurement should be clearly visible and readable
- Keep height measurements and annotations outside the log section area
- Avoid placing text or measurements on top of the log section
- Use black and white images for best results

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/right4mat/logSectionAnalyzer.git
   cd logsections
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

1. Click "Upload Images" to select one or more log section images
2. Wait for the processing to complete
3. View the results in the table below the images
4. Click "Export to Excel" to download a detailed report

## Technical Details

The application uses several key technologies:

- **OpenCV.js**: For image processing and geometric calculations
- **Tesseract.js**: For OCR-based height detection
- **ExcelJS**: For generating detailed Excel reports
- **Next.js**: For the web interface
- **tRPC**: For type-safe API communication
- **Tailwind CSS**: For styling and responsive design

## TODO

- Break down LogAnalyzer component into smaller, reusable components:
  - ImageUploader
  - ProcessingStatus
  - ResultsTable
  - ImageGallery
  - PaginationControls
  - ExportButton
- Add proper loading states for each component
- Implement error boundaries
- Add unit tests for each component
- Future enhancement: Integrate OpenAI API to:
  - Pre-process images to identify rotting wood sections and remove from image (currently manual)
  - Automatically convert images to black and white (currently manual)
  - Note: Currently out of scope but planned for future iterations
