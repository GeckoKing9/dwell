import { t } from '../../shared/i18n.ts';
import { categoryOf } from '../../stats/categories.ts';
import { CATEGORIES } from '../../store/schema.ts';
import type { Settings } from '../../store/schema.ts';
import { categoryName } from '../labels.ts';
import { idSlug } from '../settingsUi.ts';
import type { SettingsHandlers } from '../settingsUi.ts';

/** One select per recorded site; the change replaces the whole category map. */
export function CategoryEditor({ settings, sites, on }: { settings: Settings; sites: readonly string[]; on: SettingsHandlers }) {
  if (sites.length === 0) {
    return (
      <p class="empty-note" id="cats-empty">
        {t('catsEmpty')}
      </p>
    );
  }
  return (
    <div class="cat-editor">
      {sites.map((site) => (
        <label key={site}>
          <span class="d">{site}</span>
          <select
            class="field"
            id={`cat-${idSlug(site)}`}
            value={categoryOf(site, settings.categories)}
            onChange={(e) => {
              const picked = CATEGORIES.find((c) => c === e.currentTarget.value);
              if (picked) on.change({ categories: { ...settings.categories, [site]: picked } });
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryName(c)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
