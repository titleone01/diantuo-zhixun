param([ValidateSet('Compact', 'Develop')][string]$Mode = 'Compact')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# Keep the paths consumed by Git, the runtime and existing tools stable.
$technical = @('.git', '.github', '.local', '.local-training', '.next', '.openai', '.vinext', '.wrangler',
    'app', 'architecture', 'db', 'dist', 'docs', 'drizzle', 'e2e', 'examples', 'github-pages',
    'node_modules', 'outputs', 'pages', 'pages-dist', 'public', 'scripts', 'server', 'shared', 'tests', 'worker',
    'test-results', 'playwright-report', 'coverage', 'work', 'AGENTS.md', 'README.md', 'design-qa.md',
    'drizzle.config.ts', 'eslint.config.mjs', 'next-env.d.ts', 'next.config.ts', 'package-lock.json',
    'package.json', 'playwright.config.mjs', 'postcss.config.mjs', 'tsconfig.json', 'tsconfig.tsbuildinfo',
    'vite-env.d.ts', 'vite.config.ts', 'vite.pages.config.ts', 'worker-configuration.d.ts',
    'wrangler.jsonc', 'wrangler.local.jsonc', '.dev.vars', '.dev.vars.example', '.gitignore')
$items = Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -in $technical -or $_.Name -like '.codex-*.log' }
foreach ($item in $items) {
    if ($Mode -eq 'Compact' -or $item.Name -eq '.git') { $item.Attributes = $item.Attributes -bor [IO.FileAttributes]::Hidden }
    else { $item.Attributes = $item.Attributes -band (-bnot [IO.FileAttributes]::Hidden) }
}
Write-Output ('Folder view: ' + $Mode)
