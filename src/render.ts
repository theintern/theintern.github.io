import * as MarkdownIt from 'markdown-it';
import * as hljs from 'highlight.js';
import * as h from 'hyperscript';

import { DocInfo, DocSetInfo, DocType, getDocSet, getProjectUrl } from './docs';
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
	const docset = getDocSet(info)!;
	const docsetUrl = getProjectUrl(info.project);
	const dv = docset.docs;
	return h('a.source-link', {
		title: 'View page source',
		href: `${docsetUrl}/blob/${dv.branch}/${page}`
	});
}

/**
 * Create a link item for a menu
 */
export function createLinkItem(
	content: Element | string,
	info: Partial<DocInfo>
) {
	let text: string;
	let classes: string[] = [];
	if (typeof content === 'string') {
		text = content;
	} else {
		text = content.textContent!;
		for (let i = 0; i < content.classList.length; i++) {
			classes.push(content.classList[i]);
		}
	}
	return h(
		'li',
		{},
		h(
			'a',
			{
				href: createHash(info),
				title: text,
				className: classes.join(' ')
			},
			h('span', {}, text)
		)
	);
}

/**
 * Setup an HTML heading to support icons
 */
export function addHeadingIcons(heading: Element) {
	const existing = heading.querySelector('.heading-icons');
	if (existing != null) {
		return existing.childNodes[1];
	}

	const container = h('span.heading-icons', {}, [h('span'), h('span')]);
	const icons = container.childNodes[1];

	const content = heading.textContent!;
	heading.textContent = '';
	heading.appendChild(document.createTextNode(content));
	heading.appendChild(container);
	heading.classList.add('has-heading-icons');

	return icons;
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

/**
 * Create the sidebar menu for a docset
 */
export function renderMenu(info: DocSetInfo, type: DocType, maxDepth = 3) {
	const docset = getDocSet(info)!;
	const docs = docset.docs;
	const pageNames = type === 'api' ? docs.apiPages! : docs.pages;
	const cache = type === 'api' ? docs.apiCache! : docs.pageCache!;
	const menu = h('ul.menu-list');

	pageNames.forEach(pageName => {
		const page = cache[pageName];
		let root: MenuNode;
		try {
			root = createNode(page.element.querySelector('h1')!);
		} catch (error) {
			root = {
				level: 1,
				element: h('li'),
				children: []
			};
		}

		const headingTags = [];
		for (let i = 2; i <= maxDepth; i++) {
			headingTags.push(`h${i}`);
		}

		const headings = page.element.querySelectorAll(headingTags.join(','))!;
		const stack: MenuNode[][] = <MenuNode[][]>[[root]];
		let children: MenuNode[];

		for (let i = 0; i < headings.length; i++) {
			let heading = headings[i];
			let newNode = createNode(heading);
			let level = newNode.level;

			if (level === stack[0][0].level) {
				stack[0].unshift(newNode);
			} else if (level > stack[0][0].level) {
				stack.unshift([newNode]);
			} else {
				while (stack[0][0].level > level) {
					children = stack.shift()!.reverse();
					stack[0][0].children = children;
				}
				if (level === stack[0][0].level) {
					stack[0].unshift(newNode);
				} else {
					stack.unshift([newNode]);
				}
			}
		}

		while (stack.length > 1) {
			children = stack.shift()!.reverse();
			stack[0][0].children = children;
		}

		const li = createLinkItem(page.title, { page: pageName, type });
		if (root.children.length > 0) {
			li.appendChild(createSubMenu(root.children, pageName));
		}

		menu.appendChild(li);
	});

	return menu;

	function createSubMenu(children: MenuNode[], pageName: string) {
		const ul = h('ul');

		children.forEach(child => {
			const heading = child.element;
			const li = createLinkItem(heading, {
				page: pageName,
				section: heading.id,
				type
			});
			if (child.children.length > 0) {
				li.appendChild(createSubMenu(child.children, pageName));
			}
			ul.appendChild(li);
		});

		return ul;
	}

	function createNode(heading: Element) {
		const level = parseInt(heading.tagName.slice(1), 10);
		return { level, element: heading, children: <MenuNode[]>[] };
	}
}

/**
 * Render a doc page
 */
export function renderDocPage(text: string, docset: DocSetInfo) {
	text = filterGhContent(text);
	const html = renderMarkdown(text, {
		info: { page: name }
	});
	const element = h('div', { innerHTML: html });

	const h1 = element.querySelector('h1')!;
	const icons = addHeadingIcons(h1);
	const link = createGitHubLink(docset, name);
	link.classList.add('edit-page');
	icons.appendChild(link);
	element.insertBefore(h1, element.firstChild);

	return element;
}

/**
 * Remove content that may be in the raw GH pages documents but shouldn't be
 */
function filterGhContent(text: string) {
	// This would be simpler with regular expressions, but that makes IE10
	// sad.
	const markers = [
		['<!-- vim-markdown-toc GFM -->', '<!-- vim-markdown-toc -->'],
		['<!-- start-github-only -->', '<!-- end-github-only -->']
	];
	return markers.reduce((text, marker) => {
		const chunks = [];
		let start = 0;
		let left = text.indexOf(marker[0]);
		let right = 0;
		while (left !== -1) {
			chunks.push(text.slice(start, left));
			right = text.indexOf(marker[1], left);
			if (right === -1) {
				break;
			}
			start = right + marker[1].length + 1;
			left = text.indexOf(marker[0], start);
		}
		if (right !== -1) {
			chunks.push(text.slice(start));
		}
		return chunks.join('');
	}, text);
}

let markdown: MarkdownIt.MarkdownIt;

interface MenuNode {
	level: number;
	element: Element;
	children: MenuNode[];
}
