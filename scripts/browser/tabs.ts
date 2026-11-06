import { spring } from 'motion'
import { animate } from 'motion/mini'

// One pill slides between the example tabs. The page's inline script owns which tab is selected;
// this only follows it. If this bundle doesn't load, the selected tab colors itself instead.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const list = document.querySelector<HTMLElement>('.tabs')
if (list) {
  const pill = document.createElement('span')
  pill.className = 'tab-pill'
  pill.setAttribute('aria-hidden', 'true')
  list.prepend(pill)

  const selected = () => {
    const tab = list.querySelector<HTMLElement>('[aria-selected="true"]')
    return {
      transform: `translate(${tab?.offsetLeft ?? 0}px, ${tab?.offsetTop ?? 0}px)`,
      width: `${tab?.offsetWidth ?? 0}px`,
      height: `${tab?.offsetHeight ?? 0}px`,
    }
  }

  let sliding: ReturnType<typeof animate> | undefined
  const place = () => {
    sliding?.cancel()
    Object.assign(pill.style, selected())
  }
  // A selection made mid-slide retargets from wherever the pill is
  const slide = () => {
    sliding = animate(pill, selected(), { type: spring, visualDuration: 0.38, bounce: 0.18 })
  }

  place()
  list.classList.add('has-pill')
  new MutationObserver(() => (reducedMotion.matches ? place() : slide())).observe(list, {
    subtree: true,
    attributeFilter: ['aria-selected'],
  })
  // The tabs change size, and can rewrap, with the window and once the display font arrives
  new ResizeObserver(place).observe(list)
  document.fonts?.ready.then(place)
}
