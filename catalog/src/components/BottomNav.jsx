import { Clapperboard, Sparkles, Bookmark, Newspaper, Search } from 'lucide-react';

/**
 * Primary navigation lives at the BOTTOM.
 *
 * A 390pt phone cannot hold a wordmark, a search field and four icons on one
 * row without every target dropping under 44pt. Down here each tab is a full
 * 44pt square inside thumb reach, and the header is free to be nothing at all.
 */
const TABS = [
  { id: 'feed',    label: 'Feed',    Icon: Clapperboard },
  { id: 'tonight', label: 'Tonight', Icon: Sparkles },
  { id: 'mine',    label: 'Mine',    Icon: Bookmark },
  { id: 'news',    label: 'News',    Icon: Newspaper },
  { id: 'search',  label: 'Search',  Icon: Search },
];

export default function BottomNav({ tab, onChange, badge = {} }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 glass pb-safe"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1">
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={on ? 'page' : undefined}
                className={`tap relative w-full flex-col gap-0.5 py-1.5 transition
                  ${on ? 'text-white' : 'text-haze-400 active:text-haze-200'}`}
              >
                <Icon size={21} strokeWidth={on ? 2.4 : 1.8} />
                <span className={`text-[10px] leading-none ${on ? 'font-semibold' : ''}`}>
                  {label}
                </span>
                {badge[id] > 0 && (
                  <span className="absolute right-[22%] top-1 min-w-[15px] rounded-full bg-pop
                                   px-1 text-[9px] font-bold leading-[15px] text-white">
                    {badge[id] > 9 ? '9+' : badge[id]}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
