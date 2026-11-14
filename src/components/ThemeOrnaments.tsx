/** Decorative only. The shared stylesheet supplies layout; the theme supplies
 * its frame and top-left corner assets through the registered artwork slots. */
export function ThemeOrnaments({ surface }: { surface: "lobby" | "table" }) {
  return (
    <div className="theme-ornaments" data-surface={surface} aria-hidden="true">
      <span /><span /><span /><span />
    </div>
  );
}
