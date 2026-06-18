// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import starlightLlmsTxt from 'starlight-llms-txt';

// https://astro.build/config
export default defineConfig({
	// GitHub Pages project site. To move to a custom domain later:
	//   set `site` to the domain, remove `base`, and add `public/CNAME`.
	site: 'https://tivaliy.github.io',
	base: '/skiller/',
	// Add an entry whenever a page's URL changes, so old links (README, Marketplace,
	// search engines) keep working — GitHub Pages has no server-side redirects.
	redirects: {},
	integrations: [
		// astro-mermaid must come BEFORE starlight so it can transform
		// ```mermaid code blocks before Starlight's code highlighter.
		mermaid({
			theme: 'default',
			autoTheme: true,
		}),
		starlight({
			title: 'Skiller',
			description:
				'Declarative, human-in-the-loop workflow runner for VS Code chat. Author branching YAML playbooks that orchestrate your language model and MCP tools.',
			logo: {
				src: './src/assets/icon.svg',
				alt: 'Skiller',
			},
			favicon: '/favicon.svg',
			customCss: ['./src/styles/custom.css'],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/tivaliy/skiller' }],
			editLink: {
				baseUrl: 'https://github.com/tivaliy/skiller/edit/main/docs/',
			},
			sidebar: [
				{ label: 'Getting Started', items: [{ autogenerate: { directory: 'getting-started' } }] },
				{ label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
				{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
			],
			plugins: [starlightLlmsTxt()],
		}),
	],
});
