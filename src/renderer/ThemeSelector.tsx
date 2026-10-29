import { useState } from 'react';
import { Dropdown } from './Dropdown';
import { readTheme, saveTheme, THEMES, type Theme } from './theme';

export function ThemeSelector({ inspector = false }: { inspector?: boolean }) {
  const [theme, setTheme] = useState(readTheme);
  return <Dropdown label={inspector ? '外觀' : 'Theme'} value={theme} options={THEMES.map(option => ({ value: option.id, label: inspector ? ({ green: '深藍', charcoal: '石墨', light: '淺色' }[option.id]) : option.label }))}
    onChange={value => {
      const next = value as Theme;
      setTheme(next);
      saveTheme(next);
    }} />;
}
