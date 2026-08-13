import { readFile } from 'node:fs/promises'
import postcss from 'postcss'

const appCssUrl = new URL('../dist/build/app/app.css', import.meta.url)
const manifestUrl = new URL('../dist/build/app/manifest.json', import.meta.url)

const css = await readFile(appCssUrl, 'utf8')
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
const root = postcss.parse(css)

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function findRule(selectorFragment) {
  let match
  root.walkRules((rule) => {
    if (!match && rule.selector.includes(selectorFragment)) {
      match = rule
    }
  })
  assert(match, `Missing App CSS rule containing ${selectorFragment}`)
  return match
}

function declarationValues(rule) {
  const values = new Map()
  rule.walkDecls((declaration) => {
    const existing = values.get(declaration.prop) ?? []
    existing.push(declaration.value)
    values.set(declaration.prop, existing)
  })
  return values
}

let hasSpacingTheme = false
root.walkDecls('--spacing', (declaration) => {
  hasSpacingTheme ||= declaration.value === '0.25rem'
})
assert(hasSpacingTheme, 'Missing Tailwind --spacing theme variable')

const paddingValues = declarationValues(findRule('.p-5'))
assert(
  paddingValues.get('padding')?.includes('calc(var(--spacing) * 5)'),
  'p-5 must preserve its runtime --spacing calculation',
)

const spaceYValues = declarationValues(findRule('.space-y-5'))
assert(spaceYValues.get('--tw-space-y-reverse')?.includes('0'), 'space-y-5 must initialize its reverse variable')
assert(
  spaceYValues.get('margin-block-start')?.includes('calc(calc(var(--spacing) * 5) * var(--tw-space-y-reverse))'),
  'space-y-5 must preserve its start-margin reverse formula',
)
assert(
  spaceYValues.get('margin-block-end')?.includes('calc(calc(var(--spacing) * 5) * calc(1 - var(--tw-space-y-reverse)))'),
  'space-y-5 must preserve its end-margin reverse formula',
)

const clipValues = declarationValues(findRule('.bg-clip-text'))
assert(clipValues.get('-webkit-background-clip')?.includes('text'), 'bg-clip-text must include the WebKit fallback')
assert(clipValues.get('background-clip')?.includes('text'), 'bg-clip-text must retain the standard declaration')

for (const platform of ['android', 'iPhone', 'iPad']) {
  assert(manifest['@platforms']?.includes(platform), `App manifest must include ${platform}`)
}

console.log('App CSS compatibility smoke test passed')
