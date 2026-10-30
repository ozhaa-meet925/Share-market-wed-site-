import { Search as SearchIcon } from 'lucide-react';

const Search = ({ value, onChange, placeholder = 'Search stocks, IPOs, commodities' }) => (
  <label className="search-box">
    <SearchIcon size={18} />
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
  </label>
);

export default Search;
