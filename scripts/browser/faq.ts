import { animate } from 'motion/mini'

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
for (const details of document.querySelectorAll<HTMLDetailsElement>('.faq details')) {
  const summary = details.querySelector('summary')
  if (!summary) continue
  let animation: ReturnType<typeof animate> | undefined
  let expanded = details.open
  summary.addEventListener('click', (event) => {
    if (reducedMotion.matches) return
    event.preventDefault()
    const height = details.getBoundingClientRect().height
    animation?.stop()
    expanded = !expanded
    details.style.height = ''
    details.open = true
    const target = expanded ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height
    details.style.overflow = 'hidden'
    animation = animate(details, { height: [height + 'px', target + 'px'] }, {
      duration: expanded ? 0.36 : 0.28,
      ease: [0.22, 1, 0.36, 1],
      onComplete: () => {
        details.open = expanded
        details.style.height = ''
        details.style.overflow = ''
        animation = undefined
      },
    })
  })
}
