import { THEME_IDS, THEME_LABELS, type ThemeId } from './themeTypes';
import { useTheme } from './ThemeContext';

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();

  return (
    <label className="theme-select">
      <span className="theme-select__label">Theme</span>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        aria-label="Color theme"
      >
        {THEME_IDS.map((id) => (
          <option key={id} value={id}>
            {THEME_LABELS[id]}
          </option>
        ))}
      </select>
    </label>
  );
}
