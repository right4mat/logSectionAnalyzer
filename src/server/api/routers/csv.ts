import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const csvRouter = createTRPCRouter({
  "create-csv": publicProcedure
    .input(z.object({
      data: z.array(z.record(z.string())),
      filename: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.data.length === 0) {
        throw new Error("Data array cannot be empty");
      }

      // Convert data to CSV format
      const headers = Object.keys(input.data[0]!);
      const csvRows = [
        headers.join(','),
        ...input.data.map(row => 
          headers.map(header => 
            JSON.stringify(row[header] ?? '')
          ).join(',')
        )
      ];
      
      const csvContent = csvRows.join('\n');
      
      return {
        content: csvContent,
        filename: input.filename ?? 'export.csv'
      };
    }),
}); 