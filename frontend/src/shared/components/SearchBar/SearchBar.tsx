import React, { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import { Goal } from '../../../types/goals';
import './SearchBar.css';

type SearchBarSize = 'sm' | 'md' | 'lg';

export interface SearchBarProps {
  items: Goal[];
  value?: string;
  defaultValue?: string;
  onChange?: (query: string) => void;
  onResults: (results: Array<{ item: Goal; score: number }>, ids: number[]) => void;
  keys?: Array<keyof Goal | string>;
  debounceMs?: number;
  placeholder?: string;
  size?: SearchBarSize;
  fullWidth?: boolean;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  showFilterToggle?: boolean;
  filterActive?: boolean;
  onFilterToggle?: () => void;
  useLegacyListStyles?: boolean; // Render with List.tsx's original class names
  excludeGoalTypes?: Array<Goal['goal_type']>;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  items,
  value,
  defaultValue,
  onChange,
  onResults,
  keys = ['name', 'description'],
  debounceMs = 200,
  placeholder = 'Search goals…',
  size = 'md',
  fullWidth = true,
  className,
  inputProps,
  showFilterToggle,
  filterActive,
  onFilterToggle,
  useLegacyListStyles,
  excludeGoalTypes
}) => {
  const isControlled = value !== undefined;
  const [internalQuery, setInternalQuery] = useState<string>(defaultValue || '');
  const query = isControlled ? (value as string) : internalQuery;
  const inputRef = useRef<HTMLInputElement>(null);
  const lastResultsRef = useRef<Array<{ item: Goal; score: number }>>([]);
  const lastIdsRef = useRef<number[]>([]);
  const prevTrimmedRef = useRef<string>('');
  const onResultsRef = useRef(onResults);

  useEffect(() => {
    onResultsRef.current = onResults;
  }, [onResults]);

  const effectiveItems = useMemo(() => {
    return items.filter(it => !excludeGoalTypes || !excludeGoalTypes.includes(it.goal_type));
  }, [items, excludeGoalTypes]);

  const keysSignature = useMemo(() => JSON.stringify(keys), [keys]);

  const fuse = useMemo(() => {
    return new Fuse(effectiveItems, {
      keys: keys as string[],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
      useExtendedSearch: false
    });
  }, [effectiveItems, keysSignature, keys]);

  useEffect(() => {
    const trimmed = (query || '').trim();

    // If empty: clear once (avoid repeated emissions on rerenders)
    if (!trimmed) {
      const shouldEmitClear = prevTrimmedRef.current !== '' || lastIdsRef.current.length > 0;
      if (shouldEmitClear) {
        lastResultsRef.current = [];
        lastIdsRef.current = [];
        onResultsRef.current([], []);
      }
      prevTrimmedRef.current = '';
      return;
    }

    // Non-empty query: emit interim results to avoid empty flicker
    const wasEmpty = prevTrimmedRef.current.length === 0;
    if (wasEmpty) {
      // First character typed: show full list until fuzzy results are ready
      const passThroughResults = effectiveItems.map(it => ({ item: it, score: 1 }));
      const allIds = effectiveItems.map(it => it.id);
      lastResultsRef.current = passThroughResults;
      lastIdsRef.current = allIds;
      onResultsRef.current(passThroughResults, allIds);
    }

    const handle = setTimeout(() => {
      try {
        const results = fuse.search(trimmed) as Array<{ item: Goal; score: number | undefined }>;
        const ids = results.map(r => (r.item as Goal).id);
        lastResultsRef.current = results as any;
        lastIdsRef.current = ids;
        onResultsRef.current(results as any, ids);
      } catch {
        lastResultsRef.current = [];
        lastIdsRef.current = [];
        onResultsRef.current([], []);
      }
    }, Math.max(0, debounceMs));

    prevTrimmedRef.current = trimmed;
    return () => clearTimeout(handle);
  }, [query, fuse, debounceMs, effectiveItems]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (!isControlled) setInternalQuery(next);
    if (onChange) onChange(next);
  };

  const onClear = () => {
    if (!isControlled) setInternalQuery('');
    if (onChange) onChange('');
    // return focus to the input for fast re-typing
    if (inputRef.current) inputRef.current.focus();
  };

  const showClear = (query || '').length > 0;

  if (useLegacyListStyles) {
    // Render with List.tsx's original classes for identical appearance
    return (
      <div className={["search-section", className || ''].filter(Boolean).join(' ')}>
        <div className="search-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder={placeholder}
            value={query}
            onChange={onInputChange}
            spellCheck={false}
            autoComplete="off"
            {...inputProps}
          />
          {showClear && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="Clear search"
              onClick={onClear}
            >
              <svg className="search-clear-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
        {showFilterToggle && (
          <button
            type="button"
            onClick={onFilterToggle}
            className={["filter-toggle-button", filterActive ? 'active' : ''].filter(Boolean).join(' ')}
            aria-pressed={!!filterActive}
            aria-label="Toggle filters"
          >
            <svg className="filter-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707l-5.414 5.414a1 1 0 00-.293.707v4.586a1 1 0 01-.293.707l-2 2A1 1 0 0112 20v-5.586a1 1 0 00-.293-.707L6.293 7.707A1 1 0 016 7V4z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  const sizeClass = size === 'sm' ? 'size-sm' : size === 'lg' ? 'size-lg' : 'size-md';
  const classes = [
    'searchbar',
    sizeClass,
    fullWidth ? 'full' : '',
    className || ''
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="searchbar-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="searchbar-input"
          placeholder={placeholder}
          value={query}
          onChange={onInputChange}
          spellCheck={false}
          autoComplete="off"
          {...inputProps}
        />
        {showClear && (
          <button
            type="button"
            className="searchbar-clear-btn"
            aria-label="Clear search"
            onClick={onClear}
          >
            <svg className="searchbar-clear-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
      {showFilterToggle && (
        <button
          type="button"
          className={`searchbar-filter-btn ${filterActive ? 'active' : ''}`}
          onClick={onFilterToggle}
          aria-pressed={!!filterActive}
          aria-label="Toggle filters"
        >
          <svg className="searchbar-filter-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707l-5.414 5.414a1 1 0 00-.293.707v4.586a1 1 0 01-.293.707l-2 2A1 1 0 0112 20v-5.586a1 1 0 00-.293-.707L6.293 7.707A1 1 0 016 7V4z" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SearchBar;


