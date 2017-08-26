import * as MarkdownIt from 'markdown-it';
import * as hljs from 'highlight.js';

import { DocInfo, getDocSet, getProjectUrl } from './docs';
import { createHash } from './hash';

export interface Slugifier {
	(url: string): string;
}

/**
 * Create a link to a page's source on GitHub
 */
export function createGitHubLink(
	info: { project: string; version: string },
	page: string
) {
	const link = document.createElement('a');
	link.title = 'View page source';
	link.className = 'source-link';

	const docset = getDocSet(info)!;
	const docsetUrl = getProjectUrl(info.project);
	const dv = docset.docs;
	link.href = `${docsetUrl}/blob/${dv.branch}/${page}`;

	return link;
}

/**
 * Create a link item for a menu
 */
export function createLinkItem(text: string, info: Partial<DocInfo>) {
	const li = document.createElement('li');
	const link = document.createElement('a');
	link.href = createHash(info);
	link.textContent = text;
	link.title = text;
	li.appendChild(link);
	return li;
}

/**
 * Create a function to generate URL slugs for a page.
 */
export function createSlugifier() {
	const cache: { [slug: string]: boolean } = Object.create(null);
	return (str: string) => {
		let slug = str
			.toLowerCase()
			.replace(/[^A-Za-z0-9_ ]/g, '')
			.replace(/\s+/g, '-');
		if (cache[slug]) {
			let i = 1;
			let next = `${slug}-${i}`;
			while (cache[next]) {
				i++;
				next = `${slug}-${i}`;
			}
			slug = next;
		}
		cache[slug] = true;
		return slug;
	};
}

/**
 * Render markdown into HTML. Lazily initialize the markdown renderer.
 */
export function renderMarkdown(
	text: string,
	context: { info?: Partial<DocInfo>; slugify?: Slugifier }
) {
	if (!markdown) {
		markdown = new MarkdownIt({
			// Customize the syntax highlighting process
			highlight: (str: string, lang: string) => {
				if (lang && hljs.getLanguage(lang)) {
					try {
						return (
							'<pre><code class="hljs language-' +
							lang +
							'">' +
							hljs.highlight(lang, str, true).value +
							'</code></pre>'
						);
					} catch (error) {
						console.error(error);
					}
				}

				return '<pre><code class="hljs">' + str + '</code></pre>';
			},

			// allow HTML in markdown to pass through
			html: true
		});

		// Add 'table' class to tables
		markdown.renderer.rules.table_open = () => {
			return '<table class="table is-bordered">';
		};

		markdown.renderer.rules.thead_open = (tokens: any[], idx: number) => {
			let i = idx + 2;
			let token = tokens[i];
			let empty = true;
			while (token && token.type !== 'tr_close') {
				let token2 = tokens[i + 2];
				if (
					token.type !== 'th_open' ||
					!token2 ||
					token2.type !== 'th_close'
				) {
					empty = false;
					break;
				}
				let token1 = tokens[i + 1];
				if (token1.type !== 'inline' || token1.children.length > 0) {
					empty = false;
					break;
				}
				i += 3;
				token = tokens[i];
			}
			return `<thead${empty ? ' class="is-hidden"' : ''}>`;
		};

		// Style blockquotes that are used for warning or info asides
		markdown.renderer.rules.blockquote_open = (
			tokens: any[],
			idx: number
		) => {
			// Get the token representing the first chunk of the block
			// quote
			const token = tokens[idx + 2].children[0];

			const warning = '⚠️';
			const info = '💡';
			const deprecated = '👎';

			if (token.content.indexOf(warning) === 0) {
				token.content = token.content
					.replace(warning, '')
					.replace(/^\s*/, '');
				return '<blockquote class="warning"><div><i class="fa fa-warning" aria-hidden="true"></i></div>';
			} else if (token.content.indexOf(info) === 0) {
				token.content = token.content
					.replace(info, '')
					.replace(/^\s*/, '');
				return '<blockquote class="info"><div><i class="fa fa-lightbulb-o" aria-hidden="true"></i></div>';
			} else if (token.content.indexOf(deprecated) === 0) {
				token.content = token.content
					.replace(deprecated, '')
					.replace(/^\s*/, '');
				return '<blockquote class="deprecated"><div><i class="fa fa-thumbs-o-down" aria-hidden="true"></i></div>';
			}

			return '<blockquote>';
		};

		// Update relative links to markdown files
		const defaultLinkRender =
			markdown.renderer.rules.link_open ||
			((
				tokens: any[],
				idx: number,
				options: any,
				_env: any,
				self: any
			) => {
				return self.renderToken(tokens, idx, options);
			});
		markdown.renderer.rules.link_open = (
			tokens: any[],
			idx: number,
			options: any,
			env: any,
			self: any
		) => {
			const hrefIdx = tokens[idx].attrIndex('href');
			const href = tokens[idx].attrs[hrefIdx];
			const [file, hash] = href[1].split('#');
			if (!file) {
				// This is an in-page anchor link
				href[1] = createHash({ page: env.page, section: hash });
			} else if (!/\/\//.test(file)) {
				// This is a link to a local markdown file. Make a hash
				// link that's relative to the current page.
				if (env.info) {
					const { page, type } = env.info;
					const cleanFile = file.replace(/^\.\//, '');
					let pageBase = '';
					if (page.indexOf('/') !== -1) {
						pageBase = page.slice(0, page.lastIndexOf('/') + 1);
					}

					// API links may be to things like 'Class.member'.
					if (
						type === 'api' &&
						/\w+\.\w+/.test(cleanFile) &&
						!/\.md$/.test(cleanFile)
					) {
						const [mod, member] = cleanFile.split('.');
						href[1] = createHash({
							page: pageBase + mod,
							section: member,
							type
						});
					} else {
						href[1] = createHash({
							page: pageBase + cleanFile,
							section: hash,
							type
						});
					}
				}
			}
			return defaultLinkRender(tokens, idx, options, env, self);
		};

		// Generating heading IDs for in-page links
		markdown.renderer.rules.heading_open = (
			tokens: any[],
			idx: number,
			_options: any,
			env: any
		) => {
			const token = tokens[idx];
			const content = tokens[idx + 1].content;
			const id = env.slugify(content);
			return `<${token.tag} id="${id}">`;
		};
	}

	context = context || Object.create(null);
	context.slugify = context.slugify || createSlugifier();

	return markdown.render(text, context);
}

let markdown: MarkdownIt.MarkdownIt;
