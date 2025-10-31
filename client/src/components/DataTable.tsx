import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface Column {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  render?: (value: any, row: any) => React.ReactNode;
  cellClassName?: (value: any, row: any) => string;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  onRowClick?: (row: any) => void;
}

export default function DataTable({ columns, data, onRowClick }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (sortDirection === "asc") {
      return aVal > bVal ? 1 : -1;
    }
    return aVal < bVal ? 1 : -1;
  });

  return (
    <div className="border rounded-lg" data-testid="data-table">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead 
                key={column.key} 
                className={`${column.align === "right" ? "text-right" : ""} ${column.sortable ? "cursor-pointer select-none" : ""}`}
                onClick={() => column.sortable && handleSort(column.key)}
                data-testid={`table-header-${column.key}`}
              >
                <div className={`flex items-center gap-1 ${column.align === "right" ? "justify-end" : ""}`}>
                  {column.label}
                  {column.sortable && <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </TableHead>
            ))}
            {onRowClick && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.map((row, index) => (
            <TableRow 
              key={index} 
              className={onRowClick ? "cursor-pointer hover-elevate" : ""}
              onClick={() => onRowClick?.(row)}
              data-testid={`table-row-${index}`}
            >
              {columns.map((column) => {
                const baseClassName = column.align === "right" ? "text-right font-mono" : "";
                const customClassName = column.cellClassName ? column.cellClassName(row[column.key], row) : "";
                const cellClassName = `${baseClassName} ${customClassName}`.trim();
                
                return (
                  <TableCell 
                    key={column.key} 
                    className={cellClassName}
                    data-testid={`table-cell-${column.key}-${index}`}
                  >
                    {column.render ? column.render(row[column.key], row) : row[column.key]}
                  </TableCell>
                );
              })}
              {onRowClick && (
                <TableCell className="text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
