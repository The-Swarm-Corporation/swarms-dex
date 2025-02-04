import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
      <Input
        placeholder="Search by name or symbol..."
        className="pl-10 bg-black/50 border-red-500/20 focus:border-red-500/40 transition-colors"
        onChange={(e) => onSearch(e.target.value)}
      />
    </div>
  )
} 