/**
 * Intern doc viewer
 *
 * Load process:
 *
 *   1. Polyfill.io loads, then calls the global `polyfilled` callback
 *      (implemnted below).
 *   2. The callback ensures the location hash is valid, adds a hashchange
 *      listener, and starts loading the current docset (via the processHash
 *      method). Pages are rendered and cached as they're loaded.
 *   3. When all pages have been loaded, the sidebar menu is created.
 *   4. When the document is ready and the docset has loaded and rendered, the
 *      current page and docset menu are displayed.
 */

type DocType = 'api' | 'docs';

interface DocSet {
	url: string;
	latest: string;
	next: string;
	versions: { [version: string]: Docs };
}

/**
 * Details for a specific version of a docset. If a branch is specified but url
 * or docBase are not, they will be constructed using the standard GitHub URL
 * format.
 */
interface Docs {
	// The base URL for the docset
	url?: string;
	// The base URL from which the pages should be loaded
	docBase?: string;
	// The branch or tag in the repo where docs will be loaded from.
	branch?: string;
	// The path to an API data file
	api?: string;

	// The paths to  markdown pages that make up the docset, relative to
	// docBase
	pages: string[];
	// A cache of rendered documents
	pageCache?: { [name: string]: DocPage };

	// The IDs of generated API pages
	apiPages?: string[];
	// A cache of rendered api doc pages
	apiCache?: { [name: string]: DocPage };

	// The rendered menu element
	menu?: Element;
	// The rendered api menu element
	apiMenu?: Element;
}

interface DocPage {
	name: string;
	element: Element;
	title: string;
}

interface DocSetId {
	project: string;
	version: string;
}

interface DocSetInfo {
	project: string;
	version: string;
	docs: Docs;
}

interface DocInfo {
	project: string;
	version: string;
	type: DocType;
	page: string;
	section: string;
}

interface MenuNode {
	level: number;
	element: Element;
	children: MenuNode[];
}

interface SearchResult {
	element: Element;
	section?: string;
	snippet: string;
}

// This is related to TypeDoc's Reflection class
interface ApiItem {
	comment: ApiComment;
	flags: {
		isPrivate?: boolean;
		isProtected?: boolean;
		isPublic?: boolean;
		isStatic?: boolean;
		isExported?: boolean;
		isExternal?: boolean;
		isOptional?: boolean;
		isRest?: boolean;
		hasExportAssignment?: boolean;
		isConstructorProperty?: boolean;
	};
	id: number;
	kind: number;
	kindString: string;
	name: string;
}

interface ApiData extends ApiItem {
	children: ApiData[];
	defaultValue?: string;
	groups: {
		title: string;
		kind: number;
		children: number[];
	}[];
	inheritedFrom?: ApiType;
	originalName: string;
	signatures?: ApiSignature[];
	sources?: ApiSource[];
	type?: ApiType;
}

interface ApiSource {
	fileName: string;
	line: number;
	character: number;
}

interface ApiType {
	type: string;
	value?: string;
	name?: string;
	types?: ApiType[];
	elementType?: ApiType;
	declaration?: ApiDeclaration;
	typeArguments?: ApiType[];
}

interface ApiDeclaration extends ApiItem {
	children: ApiParameter[];
	signatures: ApiSignature[];
}

interface ApiParameter extends ApiItem {
	type: ApiType;
	defaultValue?: string;
}

interface ApiSignature extends ApiItem {
	parameters?: ApiParameter[];
	type: ApiType;
}

interface ApiComment {
	shortText: string;
	text?: string;
}

declare const markdownitHeadingAnchor: any;
declare const markdownit: any;
declare const docsets: { [name: string]: DocSet };
declare const Mark: any;

/**
 * Called when all necessary polyfills have been loaded
 */
function polyfilled() {
	let markdown: any;
	let viewer: HTMLElement;
	let skipPageLoad = false;
	let ignoreScroll = false;
	let searchPanel: HTMLElement;

	const defaultDocs = {
		project: 'Intern',
		version: docsets['Intern'].latest
	};
	const maxSnippetLength = 60;
	const searchDelay = 300;
	const menuHighlightDelay = 20;
	const minSearchTermLength = 4;

	// Super simple router. The location hash fully controls the state of the
	// doc viewer. Changes to the project and version selectors will update the
	// hash, which will cause new content to be rendered.
	window.addEventListener('hashchange', processHash);

	// If the base docs page is loaded without a hash, set a default hash to
	// get a docset to load.
	if (!location.hash) {
		const docset = getDocset(defaultDocs)!;
		setHash({
			project: docset.project,
			version: docset.version,
			page: docset.docs.pages[0]
		});
	} else {
		processHash();
	}

	// Create a promise that resolves when the doc is ready (just for
	// convenience)
	const ready = new Promise(resolve => {
		window.addEventListener('load', resolve);
	});

	ready.then(() => {
		viewer = <HTMLElement>document.body;
		searchPanel = <HTMLElement>document.querySelector('.search-panel')!;

		// Handle updates to the project + version selects.
		document.querySelector(
			'.docs-nav'
		)!.addEventListener('change', event => {
			const target: Element = <Element>event.target;
			if (target.tagName !== 'SELECT') {
				return;
			}

			const select = <HTMLSelectElement>target;
			const docs = getDocInfo();

			if (target.getAttribute('data-select-property') === 'project') {
				// The project was changed
				docs.project = select.value;
				docs.version = docsets[select.value].latest;
				docs.page = getDocset(docs)!.docs.pages[0];
			} else {
				// The version was changed
				docs.version = select.value;
				docs.page = getDocset(docs)!.docs.pages[0];
			}

			setHash({
				project: docs.project,
				version: docs.version,
				page: docs.page
			});
		});

		// Open the search dropdown if the user clicks a search button
		document.querySelector(
			'.docs-nav'
		)!.addEventListener('click', event => {
			let target = <HTMLElement>event.target;

			if (target.classList.contains('fa')) {
				// An icon was clicked, get its parent
				target = target.parentElement!;
			}

			if (target.classList.contains('search-button')) {
				target.classList.toggle('is-active');
				viewer.classList.toggle('is-searching');
				if (viewer.classList.contains('is-searching')) {
					searchPanel.querySelector('input')!.focus();
				}
			} else if (target.classList.contains('navbar-burger')) {
				const menuId = target.getAttribute('data-target')!;
				const menu = document.getElementById(menuId)!;
				target.classList.toggle('is-active');
				menu.classList.toggle('is-active');
			}
		});

		// Live search as the user types into the search dropdown input
		let searchTimer: number | undefined;
		searchPanel.addEventListener('input', event => {
			if (searchTimer) {
				clearTimeout(searchTimer);
			}
			searchTimer = setTimeout(() => {
				search((<HTMLInputElement>event.target).value);
			}, searchDelay);
		});

		// Clear the search field when the user clicks the 'x' in the search box
		searchPanel.querySelector('.button')!.addEventListener('click', () => {
			const input = <HTMLInputElement>searchPanel.querySelector('input');
			input.value = '';
			search('');
			searchPanel.querySelector('input')!.focus();
		});

		// Update the url hash as the user scrolls
		let menuTimer: number | undefined;
		const content = <HTMLElement>document.querySelector('.docs-content')!;
		content.addEventListener('scroll', () => {
			const ignoring = ignoreScroll;
			ignoreScroll = false;
			if (ignoring) {
				return;
			}
			if (menuTimer) {
				clearTimeout(menuTimer);
			}
			menuTimer = setTimeout(() => {
				menuTimer = undefined;
				updateHashFromContent();
			}, menuHighlightDelay);
		});
	});

	/**
	 * Set the location hash, optionally telling the router to ignore the hash
	 * update.
	 */
	function setHash(newHash: string | Partial<DocInfo>, ignoreUpdate = false) {
		let hash = typeof newHash === 'string' ? newHash : createHash(newHash);
		if (ignoreUpdate && location.hash !== hash) {
			skipPageLoad = true;
		}
		location.hash = hash;
	}

	/**
	 * Load a docset.
	 *
	 * An optional page and section may be provided. When the docset is
	 * finished loading, the given page, or the first page in the set, will be
	 * shown.
	 */
	function loadDocset(setId: DocSetId) {
		const docset = getDocset(setId)!;
		const container = document.querySelector('.docs-content')!;

		if (
			container &&
			container.getAttribute('data-doc-project') === docset.project &&
			container.getAttribute('data-doc-version') === docset.version
		) {
			// The docset is already visible, so don't do anything
			return Promise.resolve(docset);
		}

		const pageNames = docset.docs.pages;
		const docBase = getDocBaseUrl(docset);
		const hasApi = Boolean(docset.docs.api);

		let cache = docset.docs.pageCache!;
		let load: PromiseLike<any>;

		if (!cache) {
			// The docset hasn't been loaded yet
			cache = docset.docs.pageCache = <{
				[name: string]: DocPage;
			}>Object.create(null);

			const loads: PromiseLike<any>[] = [];
			const docs = docset.docs;

			if (hasApi) {
				loads.push(
					fetch(docBase + docs.api).then(response => {
						return response.json();
					})
				);
			}

			loads.push(
				...pageNames.map(name => {
					return fetch(docBase + name)
						.then(response => response.text())
						.then(text => {
							return ready.then(() => {
								text = filterGhContent(text);
								const html = render(text, { page: name });
								const element = document.createElement('div');
								element.innerHTML = html;

								const h1 = element.querySelector('h1')!;
								element.insertBefore(h1, element.firstChild);

								const link = createGitHubLink(docset, name);
								link.classList.add('edit-page');

								h1.appendChild(link);

								const title =
									(h1 && h1.textContent) || docset.project;
								cache[name] = { name, element, title };
							});
						});
				})
			);

			load = Promise.all(loads).then(loadData => {
				if (hasApi) {
					const data = loadData[0];
					renderApiPages(
						{
							project: docset.project,
							version: docset.version
						},
						data
					);
				}

				// All pages need to have been loaded to create the docset menu
				createMenu(docset, 'docs');

				if (hasApi) {
					createMenu(docset, 'api', 4);
				}
			});
		} else {
			// The docset is already loaded
			load = Promise.resolve();
		}

		// When both the docset and the page are ready, update the UI
		return Promise.all([ready, load]).then(() => {
			updateNavBarLinks();
			updateDocsetSelector();
			return docset;
		});

		// Remove content that may be in the raw GH pages documents that
		// shouldn't
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

		//  Update the links in doc navbar
		function updateNavBarLinks() {
			const navbar = <HTMLElement>document.querySelector(
				'.docs-nav .navbar-start'
			);

			navbar.classList[docset.docs.api ? 'add' : 'remove']('has-api');
			navbar.classList[docset.docs.pages ? 'add' : 'remove']('has-docs');

			['docs', 'api'].forEach((type: DocType) => {
				const link = <HTMLLinkElement>navbar.querySelector(
					`.navbar-item[data-doc-type="${type}"]`
				)!;
				link.href = createHash({
					project: docset.project,
					version: docset.version,
					type
				});
			});
		}

		// Select the currently active project in the project selector.
		function updateDocsetSelector() {
			const docs = getDocInfo();
			const selector = document.querySelector(
				'select[data-select-property="project"]'
			)!;

			if (selector.children.length === 0) {
				Object.keys(docsets).forEach(name => {
					const option = document.createElement('option');
					option.value = name;
					option.textContent = name;
					selector.appendChild(option);
				});
			}

			const option = <HTMLOptionElement>selector.querySelector(
				`option[value="${getDocInfo().project}"]`
			);
			if (option) {
				option.selected = true;
			}

			const versions = Object.keys(docsets[docs.project].versions);
			// If more than one version is available, show the version selector
			if (versions.length > 1) {
				viewer.classList.add('multi-version');

				const selector = document.querySelector(
					'select[data-select-property="version"]'
				)!;
				selector.innerHTML = '';
				versions.forEach(version => {
					const option = document.createElement('option');
					let text = `v${version}`;
					if (version === docsets[docs.project].latest) {
						text += ' (release)';
					} else if (version === docsets[docs.project].next) {
						text += ' (dev)';
					}
					option.value = version;
					option.selected = version === docs.version;
					option.textContent = text;
					selector.appendChild(option);
				});
			} else {
				viewer.classList.remove('multi-version');
			}

			// Update the gibhub link
			const link = <HTMLAnchorElement>document.querySelector(
				'.navbar-menu a[data-title="Github"]'
			);
			link.href = getDocVersionUrl(docs);
		}
	}

	// Create the sidebar menu for a docset
	function createMenu(info: DocSetInfo, type: DocType, maxDepth = 3) {
		const docset = getDocset(info)!;
		const docs = docset.docs;
		const pageNames = type === 'api' ? docs.apiPages! : docs.pages;
		const cache = type === 'api' ? docs.apiCache! : docs.pageCache!;

		const menu = document.createElement('ul');
		menu.className = 'menu-list';
		if (type === 'api') {
			docs.apiMenu = menu;
		} else {
			docs.menu = menu;
		}

		pageNames.forEach(pageName => {
			const page = cache[pageName];
			let root: MenuNode;
			try {
				root = createNode(page.element.querySelector('h1')!);
			} catch (error) {
				root = {
					level: 1,
					element: document.createElement('li'),
					children: []
				};
			}

			const headingTags = [];
			for (let i = 2; i <= maxDepth; i++) {
				headingTags.push(`h${i}`);
			}

			const headings = page.element.querySelectorAll(
				headingTags.join(',')
			)!;
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

		function createSubMenu(children: MenuNode[], pageName: string) {
			const ul = document.createElement('ul');

			children.forEach(child => {
				const heading = child.element;
				const li = createLinkItem(heading.textContent!, {
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
	 * Create a link item for a menu
	 */
	function createLinkItem(text: string, info: Partial<DocInfo>) {
		const li = document.createElement('li');
		const link = document.createElement('a');
		link.href = createHash(info);
		link.textContent = text;
		link.title = text;
		li.appendChild(link);
		return li;
	}

	/**
	 * Show a page in the currently loaded docset
	 */
	function showPage(type: DocType, name: string, section?: string) {
		const docset = getDocset()!.docs;
		const page = getPage(docset, type, name);
		const content = <HTMLElement>document.body.querySelector(
			'.docs-content'
		)!;
		if (content.children.length > 0) {
			content.removeChild(content.children[0]);
		}
		content.appendChild(page.element);

		// Do highlighting before scrolling a sectoin into view. Highlighting
		// also involves scroll manipulation, and if the viewer is using a
		// mobile layout, we want the content scroll to take priority over the
		// menu scroll.
		highlightActivePage();
		highlightActiveSection();

		// Showing the page will probably scroll the content area, but we don't
		// want to invoke the normal scroll handling code in this case.
		ignoreScroll = true;

		if (section) {
			const header = <HTMLElement>document.querySelector(`#${section}`);
			if (header) {
				header.scrollIntoView();
			}
		} else {
			content.scrollTop = 0;
			content.scrollIntoView();
		}
	}

	/**
	 * Get a page from a docset
	 */
	function getPage(docs: Docs, type: DocType, name?: string) {
		if (!name) {
			const pageNames = type === 'docs' ? docs.pages : docs.apiPages!;
			name = pageNames[0];
		}
		return type === 'docs' ? docs.pageCache![name] : docs.apiCache![name];
	}

	/**
	 * Highlight the active page in the sidebar menu
	 */
	function highlightActivePage() {
		const menu = document.querySelector('.docs-menu .menu .menu-list')!;
		const active = menu.querySelector('.is-active-page');
		if (active) {
			active.classList.remove('is-active-page');
		}

		const docs = getDocInfo();
		const currentPage = createHash({
			project: docs.project,
			version: docs.version,
			type: docs.type,
			page: docs.page
		});

		const pageLink = menu.querySelector(`li > a[href="${currentPage}"]`)!;
		if (pageLink) {
			pageLink.parentElement!.classList.add('is-active-page');
		}
	}

	/**
	 * Highlight the active element in the sidebar menu
	 */
	function highlightActiveSection() {
		const menu = document.querySelector('.docs-menu .menu-list')!;
		if (!menu) {
			return;
		}

		const active = menu.querySelector('.is-active');
		if (active) {
			active.classList.remove('is-active');
		}

		const currentSection = location.hash;
		let link = <HTMLElement>menu.querySelector(
			`li > a[href="${currentSection}"]`
		)!;
		if (!link) {
			const docs = getDocInfo();
			const currentPage = createHash({
				project: docs.project,
				version: docs.version,
				type: docs.type,
				page: docs.page
			});
			link = <HTMLElement>menu.querySelector(
				`li > a[href="${currentPage}"]`
			)!;
		}

		if (link) {
			link.classList.add('is-active');
			scrollIntoViewIfNessary(
				link,
				<HTMLElement>document.querySelector('.docs-menu')!
			);
		}
	}

	/**
	 * Install the current docset's docs menu in the menu container
	 */
	function showMenu(type?: DocType) {
		type = type || 'docs';
		const docs = getDocset()!.docs;
		const menu = document.querySelector('.docs-menu .menu')!;
		const menuList = menu.querySelector('.menu-list');
		if (menuList) {
			menu.removeChild(menuList);
		}
		const docMenu = type === 'docs' ? docs.menu! : docs.apiMenu!;
		menu.appendChild(docMenu);
	}

	/**
	 * Process the current URL hash value.
	 *
	 * The has has the following format:
	 *
	 *     <project>/<version>/<page>/<section>
	 */
	function processHash() {
		const ignoring = skipPageLoad;
		skipPageLoad = false;

		// Always try to update the menu highlight, even if we're skipping the
		// rest of the page load
		highlightActiveSection();

		if (ignoring) {
			return;
		}

		const hash = parseHash();
		const docset = getDocset(hash)!;

		// The hash encodes our state -- ensure it points to a valid docset
		if (!hash.version) {
			const parts: Partial<DocInfo> = {
				project: docset.project,
				version: docset.version,
				type: hash.type
			};
			if (hash.page) {
				parts.page = hash.page;
			}
			if (hash.section) {
				parts.section = hash.section;
			}
			setHash(parts);
		} else {
			loadDocset(hash).then(() => {
				viewer.setAttribute('data-doc-type', hash.type);

				const container = document.querySelector('.docs-content')!;
				container.setAttribute('data-doc-project', docset.project);
				container.setAttribute('data-doc-version', docset.version);

				showMenu(hash.type);
				showPage(hash.type, hash.page, hash.section);
			});
		}
	}

	/**
	 * Render markdown into HTML. Lazily initialize the markdown renderer.
	 */
	function render(text: string, page?: Partial<DocInfo>) {
		if (!markdown) {
			markdown = markdownit({
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

			markdown.renderer.rules.thead_open = (
				tokens: any[],
				idx: number
			) => {
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
					if (
						token1.type !== 'inline' ||
						token1.children.length > 0
					) {
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
					if (env.page) {
						const { page, type } = env.page;
						const cleanFile = file.replace(/^\.\//, '');
						let pageBase = '';
						if (page.indexOf('/') !== -1) {
							pageBase = page.slice(0, page.lastIndexOf('/') + 1);
						}
						href[1] = createHash({
							page: pageBase + cleanFile,
							section: hash,
							type
						});
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

		return markdown.render(text, { page, slugify: createSlugifier() });
	}

	/**
	 * Get information about the currently displayed docset. If the location
	 * hash does not identify a page, use default values.
	 */
	function getDocInfo() {
		const data = parseHash();
		if (!data.project) {
			data.project = defaultDocs.project;
		}
		if (!data.version) {
			data.version = docsets[data.project].latest;
		}
		if (!data.type) {
			data.type = 'docs';
		}
		if (!data.page) {
			const docs = docsets[data.project].versions[data.version];
			if (data.type === 'docs') {
				data.page = docs.pages[0];
			} else {
				data.page = docs.apiPages ? docs.apiPages[0] : '';
			}
		}
		return data;
	}

	/**
	 * Create a link hash for a given docset.
	 */
	function createHash(info: Partial<DocInfo>) {
		const currentDocs = getDocInfo();
		const docs = {
			project: currentDocs.project,
			version: currentDocs.version,
			type: 'docs',
			...info
		};
		const parts = [docs.project, docs.version, docs.type];
		if (docs.page) {
			parts.push(docs.page);

			if (docs.section) {
				parts.push(docs.section);
			}
		}
		return '#' + parts.map(encodeURIComponent).join('/');
	}

	/**
	 * Parse the hash into a DocInfo structure.
	 */
	function parseHash(): DocInfo {
		const hash = location.hash.slice(1);
		let [project, version, type, page, section] = hash
			.split('/')
			.map(part => decodeURIComponent(part));
		return <DocInfo>{ project, version, type, page, section };
	}

	/**
	 * Get a docset. If a complete setId is provided, the corresponding docset
	 * is returned. If only a project is specified, the latest version for that
	 * project will be returned. If no docset ID is provided, the currently
	 * active docset will be returned.
	 */
	function getDocset(setId?: DocSetId): DocSetInfo | undefined {
		const docs = setId || getDocInfo();
		const project = docsets[docs.project];
		if (!project) {
			return;
		}

		if (!docs.version) {
			docs.version = project.latest;
		}

		return {
			project: docs.project,
			version: docs.version!,
			docs: project.versions[docs.version]
		};
	}

	/**
	 * Search the loaded docset for a given string. Update the search results
	 * box with the results.
	 */
	function search(term: string) {
		const searchResults = searchPanel.querySelector('.search-results')!;
		searchResults.innerHTML = '';

		const highlightTerm = term.trim();
		const searchTerm = highlightTerm.toLowerCase();

		if (!highlightTerm || highlightTerm.length < minSearchTermLength) {
			return;
		}

		const docset = getDocset()!;
		const finders: PromiseLike<any>[] = [];
		for (let name of docset.docs.pages) {
			const page = docset.docs.pageCache![name];
			finders.push(
				findAllMatches(page.element).then(matches => {
					if (matches.length > 0) {
						const link = createLinkItem(page.title, { page: name });
						searchResults.appendChild(link);

						const submenu = document.createElement('ul');
						link.appendChild(submenu);

						matches.forEach(match => {
							const link = createLinkItem(match.snippet, {
								page: name,
								section: match.section
							});
							submenu.appendChild(link);
						});
					}
				})
			);
		}

		Promise.all(finders).then(() => {
			if (searchResults.childNodes.length === 0) {
				searchResults.innerHTML =
					'<li class="no-results">No results found</li>';
			} else {
				findAllMatches(searchResults, false);
			}
		});

		// Find all the matches for the user's text
		function findAllMatches(
			page: Element,
			saveMatches = true
		): Promise<SearchResult[]> {
			return new Promise(resolve => {
				const highlighter = new Mark(page);
				highlighter.unmark();

				const matches: SearchResult[] = [];
				highlighter.mark(searchTerm, {
					acrossElements: true,
					caseSensitive: false,
					ignorePunctuation: ['“', '”', '‘', '’'],
					separateWordSearch: false,
					each: (element: Element) => {
						if (saveMatches) {
							element.id = `search-result-${matches.length}`;
							matches.push({
								element,
								section: element.id,
								snippet: createSnippet(element)
							});
						}
					},
					done: () => {
						resolve(matches);
					}
				});
			});
		}

		// Get some text surrounding a search match
		function createSnippet(searchMatch: Element) {
			const searchText = searchMatch.textContent!;
			const container = getContainer(searchMatch);
			const extraLength = maxSnippetLength - searchText.length;

			const previousSibling = (node: HTMLElement) => node.previousSibling;
			let previousText = '';
			let previous = getNextTextNode(
				searchMatch,
				previousSibling,
				getRightLeaf
			);
			while (previous && previousText.length < extraLength) {
				previousText = previous.textContent! + previousText;
				previous = getNextTextNode(
					previous,
					previousSibling,
					getRightLeaf
				)!;
			}

			const nextSibling = (node: HTMLElement) => node.nextSibling;
			let nextText = '';
			let next = getNextTextNode(searchMatch, nextSibling, getLeftLeaf);
			while (next && nextText.length < extraLength) {
				nextText += next.textContent!;
				next = getNextTextNode(next, nextSibling, getLeftLeaf);
			}

			const halfExtra = extraLength / 2;
			let nextTarget = halfExtra;
			let prevTarget = halfExtra;
			if (
				nextText.length > halfExtra &&
				previousText.length > halfExtra
			) {
				nextTarget = halfExtra;
				prevTarget = halfExtra;
			} else if (nextText.length > halfExtra) {
				nextTarget = halfExtra + (halfExtra - previousText.length);
			} else if (previousText.length > halfExtra) {
				prevTarget = halfExtra + (halfExtra - nextText.length);
			}

			if (previousText.length > prevTarget) {
				previousText = `...${previousText.slice(
					previousText.length - prevTarget
				)}`;
			}
			if (nextText.length > nextTarget) {
				nextText = `${nextText.slice(0, nextTarget)}...`;
			}

			return [previousText, searchText, nextText].join('');

			// Get the next (or previous) text node from a given node. This may
			// involve some traversal of the DOM.
			function getNextTextNode(
				node: Node | null,
				getNext: (node: Node) => Node | null,
				getLeaf: (node: Node) => Node | null
			): Node | null {
				if (!node || node === container) {
					return null;
				}

				let next = getNext(node);
				if (!next) {
					return getNextTextNode(
						node.parentElement,
						getNext,
						getLeaf
					);
				}

				if (next.childNodes.length > 0) {
					next = getLeaf(next);
				}

				if (next && next.nodeType !== Node.TEXT_NODE) {
					return getNextTextNode(next, getNext, getLeaf);
				}

				return next;
			}

			// Get the leftmost leaf in the DOM, starting from a given node
			function getLeftLeaf(node: Node): Node {
				while (node.childNodes.length > 0) {
					return getLeftLeaf(node.childNodes[0]);
				}
				return node;
			}

			// Get the rightmost leaf in the DOM, starting from a given node
			function getRightLeaf(node: Node): Node {
				while (node.childNodes.length > 0) {
					return getRightLeaf(
						node.childNodes[node.childNodes.length - 1]
					);
				}
				return node;
			}

			// Get the container for an element. This is just the first
			// 'interesting' container in its ancestry tree.
			function getContainer(node: Element): Element {
				switch (node.tagName) {
					case 'H1':
					case 'H2':
					case 'H3':
					case 'H4':
					case 'P':
					case 'BLOCKQUOTE':
					case 'PRE':
					case 'LI':
					case 'TR':
					case 'TABLE':
						return node;
					default:
						return getContainer(node.parentElement!);
				}
			}
		}
	}

	/**
	 * Scroll an element into view if it's not currently visible within its
	 * container.
	 */
	function scrollIntoViewIfNessary(
		element: HTMLElement,
		container: HTMLElement
	) {
		const viewportTop = container.offsetTop + container.scrollTop;
		const viewportBottom = viewportTop + container.clientHeight;
		const elementTop = element.offsetTop;
		const elementBottom = elementTop + element.offsetHeight;
		if (elementTop < viewportTop) {
			element.scrollIntoView(true);
		} else if (elementBottom > viewportBottom) {
			element.scrollIntoView(false);
		}
	}

	/**
	 * Update the location hash based on the currently visible doc contents.
	 */
	function updateHashFromContent() {
		const content = <HTMLElement>document.querySelector('.docs-content')!;
		const elements = content.querySelectorAll('h1,h2,h3')!;
		const viewportTop = content.offsetTop + content.scrollTop;

		let above: Element | undefined;
		let below: Element | undefined;
		for (let i = 1; i < elements.length; i++) {
			const element = <HTMLElement>elements[i];
			const elementTop = getOffsetTop(element);
			if (elementTop > viewportTop) {
				below = elements[i];
				above = elements[i - 1];
				break;
			}
		}

		if (!above) {
			above = elements[elements.length - 1];
		}

		const docs = getDocInfo();
		setHash(
			{
				project: docs.project,
				version: docs.version,
				type: <DocType>viewer.getAttribute('data-doc-type')!,
				page: docs.page,
				section: above.id
			},
			true
		);

		function getOffsetTop(element: HTMLElement) {
			let top = element.offsetTop;
			while (
				(element = <HTMLElement>element.offsetParent) &&
				element !== content
			) {
				top += element.offsetTop;
			}
			return top;
		}
	}

	/**
	 * Create a link to a page's source on GitHub
	 */
	function createGitHubLink(
		info: { project: string; version: string },
		page: string
	) {
		const link = document.createElement('a');
		link.title = 'View page source';
		link.className = 'source-link';

		const docset = docsets[info.project];
		const dv = docset.versions[info.version];
		link.href = `${docset.url}/blob/${dv.branch}/${page}`;

		return link;
	}

	/**
	 * Get the project base URL for a given project version. If the docset
	 * version structure contains a `url` field, it will be used. Otherwise, a
	 * URL will be constructed using the docset version branch and standard
	 * GitHub URL formats.
	 */
	function getDocVersionUrl(info: { project: string; version: string }) {
		const docset = docsets[info.project];
		const dv = docset.versions[info.version];
		if (dv.url) {
			return dv.url;
		}
		return `${docset.url}/tree/${dv.branch}`;
	}

	/**
	 * Get the doc base URL for a given project version. If the docset version
	 * structure contains a `docBase` field, it will be used. Otherwise, a URL
	 * will be constructed using the docset version branch and standard GitHub
	 * URL formats.
	 */
	function getDocBaseUrl(info: { project: string; version: string }) {
		const docset = docsets[info.project];
		const dv = docset.versions[info.version];
		if (dv.docBase) {
			return dv.docBase;
		}
		const url = docset.url.replace(
			/\/\/github\./,
			'//raw.githubusercontent.'
		);

		return `${url}/${dv.branch}/`;
	}

	/**
	 * Create a function to generate URL slugs for a page.
	 */
	function createSlugifier() {
		const cache: { [slug: string]: boolean } = {};
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
	 * Render the API pages for a docset
	 */
	function renderApiPages(setId: DocSetId, data: ApiData) {
		const docset = getDocset(setId)!;
		const docs = docset.docs;
		const pages = (docs.apiPages = <string[]>[]);
		const cache = (docs.apiCache = <{ [key: string]: DocPage }>{});

		const modules = getExports(data)!;
		const slugify = createSlugifier();

		modules
			.filter(module => {
				return getExports(module).length > 0;
			})
			.forEach(module => {
				const name = module.name.replace(/^"/, '').replace(/"$/, '');
				pages.push(name);
				const element = document.createElement('div');
				const page = (cache[name] = { name, title: name, element });

				element.appendChild(createHeading(1, name));
				renderModule(module, page);
			});

		// Render a module page
		function renderModule(module: ApiData, page: DocPage) {
			if (module.comment) {
				renderComment(module.comment, page);
			}

			const exports = getExports(module);

			const classes = exports.filter(ex => ex.kindString === 'Class');
			if (classes.length > 0) {
				page.element.appendChild(createHeading(2, 'Classes'));
				classes.forEach(cls => {
					renderClass(cls, page);
				});
			}

			const interfaces = exports.filter(
				ex => ex.kindString === 'Interface'
			);
			if (interfaces.length > 0) {
				page.element.appendChild(createHeading(2, 'Interfaces'));
				interfaces.forEach(iface => {
					renderInterface(iface, page);
				});
			}

			const functions = exports.filter(
				ex => ex.kindString === 'Function'
			);
			if (functions.length > 0) {
				page.element.appendChild(createHeading(2, 'Functions'));
				functions.forEach(func => {
					renderFunction(func, page);
				});
			}

			const constants = exports.filter(
				ex => ex.kindString === 'Object literal'
			);
			if (constants.length > 0) {
				page.element.appendChild(createHeading(2, 'Constants'));
				constants.forEach(constant => {
					renderLiteral(constant, page);
				});
			}
		}

		// Render a class
		function renderClass(cls: ApiData, page: DocPage) {
			const heading = createHeading(3, cls.name);
			page.element.appendChild(heading);

			if (cls.sources) {
				const link = createSourceLink(cls.sources[0])!;
				if (link) {
					heading.appendChild(link);
				}
			}

			if (cls.comment) {
				renderComment(cls.comment, page);
			}

			const exports = getExports(cls);

			const properties = exports.filter(
				ex => ex.kindString === 'Property'
			);
			properties.forEach(property => {
				renderProperty(property, page);
			});
			const methods = exports.filter(
				ex =>
					ex.kindString === 'Method' ||
					ex.kindString === 'Constructor'
			);
			methods.forEach(method => {
				renderMethod(method, page);
			});
		}

		// Render a class method
		function renderMethod(method: ApiData, page: DocPage) {
			renderFunction(method, page, 4);
		}

		// Render a TypeScript interface
		function renderInterface(iface: ApiData, page: DocPage) {
			const heading = createHeading(3, iface.name);
			page.element.appendChild(heading);

			if (iface.sources) {
				const link = createSourceLink(iface.sources[0]);
				if (link) {
					heading.appendChild(link);
				}
			}

			if (iface.comment) {
				renderComment(iface.comment, page);
			}

			if (iface.signatures) {
				page.element.appendChild(createHeading(4, 'Call signatures'));
				renderSignatures(iface.signatures, page);
			}

			const exports = getExports(iface);

			const properties = exports.filter(
				ex => ex.kindString === 'Property'
			);
			properties.forEach(property => {
				renderProperty(property, page);
			});

			const methods = exports.filter(
				ex =>
					ex.kindString === 'Method' ||
					ex.kindString === 'Constructor'
			);
			methods.forEach(method => {
				renderMethod(method, page);
			});
		}

		// Render a class or interface property
		function renderProperty(property: ApiData, page: DocPage) {
			const heading = createHeading(4, property.name);
			page.element.appendChild(heading);

			if (property.sources) {
				const link = createSourceLink(property.sources[0]);
				if (link) {
					heading.appendChild(link);
				}
			}

			const text = `${property.name}: ${typeToString(property.type!)}`;
			renderCode(text, page);

			if (property.comment) {
				renderComment(property.comment, page);
			}
		}

		// Render an exported function
		function renderFunction(func: ApiData, page: DocPage, level = 3) {
			const heading = createHeading(level, func.name);
			page.element.appendChild(heading);

			if (func.sources) {
				const link = createSourceLink(func.sources[0]);
				if (link) {
					heading.appendChild(link);
				}
			}

			renderSignatures(func.signatures!, page);

			for (let signature of func.signatures!) {
				if (signature.comment) {
					renderComment(signature.comment, page);
					break;
				}
			}
		}

		// Render a function/method signature
		function renderSignatures(signatures: ApiSignature[], page: DocPage) {
			for (let sig of signatures) {
				const container = document.createElement('p');
				const text = hljs.highlight('typescript', signatureToString(sig), true).value;
				const code = document.createElement('code');
				code.className = 'hljs lang-typescript';
				code.innerHTML = text;
				container.appendChild(code);
				page.element.appendChild(container);
			}

			const parameters = signatures.reduce((params, sig) => {
				return params.concat(sig.parameters || []);
			}, <ApiParameter[]>[]);
			if (parameters.length > 0) {
				renderParameterTable(parameters, page);
			}
		}

		// Render a table of signature parameters
		function renderParameterTable(
			parameters: ApiParameter[],
			page: DocPage
		) {
			const params = parameters.filter(param => {
				return param.comment || param.defaultValue;
			});

			if (params.length > 0) {
				const rows = params.map(param => {
					const comment =
						param.comment &&
						commentToHtml(param.comment, page.name);
					return [
						param.name,
						comment || '',
						param.defaultValue || ''
					];
				});

				const p = document.createElement('p');
				const table = createTable(
					['Parameter', 'Description', 'Default'],
					rows
				);
				p.appendChild(table);
				page.element.appendChild(p);
			}
		}

		// Render a literal value
		function renderLiteral(value: ApiData, page: DocPage) {
			page.element.appendChild(createHeading(3, value.name));
			if (value.kindString === 'Object literal') {
				const parts = value.children.map(child => {
					if (child.name) {
						return `${child.name}: ${child.defaultValue}`;
					}
					return child.defaultValue;
				});
				const text = `{\n\t${parts.join(',\n\t')}\n}`;
				renderCode(text, page);
			}
		}

		// Render an element comment
		function renderComment(comment: ApiComment, page: DocPage) {
			const p = document.createElement('p');
			p.innerHTML = commentToHtml(comment, page.name);
			page.element.appendChild(p);
		}

		// Generate HTML for an API comment
		function commentToHtml(comment: ApiComment, pageName: string) {
			let parts: string[] = [];

			if (comment.shortText) {
				parts.push(renderText(comment.shortText));
			}

			if (comment.text) {
				parts.push(renderText(comment.text));
			}

			return parts.join('');

			function renderText(text: string) {
				text = text.replace(/\[\[(\w+)]]/g, '[$1]($1)');
				return render(text, { page: pageName, type: 'api' });
			}
		}

		// Render a syntax-highlighted block of code
		function renderCode(
			text: string,
			page: DocPage,
			language = 'typescript'
		) {
			const code = document.createElement('code');
			code.className = `hljs lang-${language}`;

			const formatted = hljs.highlight(language, text, true).value;
			code.innerHTML = formatted
				.replace(/\n/g, '<br>')
				.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');

			const container = document.createElement('p');
			container.appendChild(code);
			page.element.appendChild(container);
		}

		// Render a link to an element's source code
		function createSourceLink(source: ApiSource) {
			// Don't try to create links for files with absolute paths
			if (source.fileName[0] === '/') {
				return;
			}

			const link = createGitHubLink(
				{
					project: setId.project,
					version: setId.version!
				},
				`src/${source.fileName}#L${source.line}`
			);
			link.title = `${source.fileName}#L${source.line}`;
			return link;
		}

		// Generate a string representation of a function/method signature
		function signatureToString(
			signature: ApiSignature,
			isParameter = false
		): string {
			const name = signature.name === '__call' ? '' : signature.name;
			let text = `${name}(`;
			if (signature.parameters) {
				const params = signature.parameters.map(param => {
					const optional = param.flags.isOptional ? '?' : '';
					return `${param.name}${optional}: ${typeToString(
						param.type
					)}`;
				});
				text += params.join(', ');
			}

			let returnType = typeToString(signature.type);

			const sep = isParameter ? ' => ' : ': ';
			text += `)${sep}${returnType}`;

			return text;
		}

		// Generate a string representation of a type
		function typeToString(type: ApiType): string {
			if (type.type === 'stringLiteral') {
				return `'${type.value}'`;
			} else if (type.type === 'union') {
				const strings = type.types!.map(typeToString);
				return strings.join(' | ');
			} else if (type.type === 'array') {
				return `${typeToString(type.elementType!)}[]`;
			} else if (type.type === 'reflection') {
				const d = type.declaration!;
				if (d.kindString === 'Type literal') {
					if (d.children) {
						const parts = d.children.map(child => {
							return `${child.name}: ${typeToString(child.type)}`;
						});
						return `{ ${parts.join(', ')} }`;
					} else if (d.signatures) {
						return signatureToString(d.signatures[0], true);
					}
				}
			}

			let returnType = type.name!;
			if (type.typeArguments) {
				const args = type.typeArguments.map(arg => {
					return typeToString(arg);
				});
				returnType += `<${args.join(', ')}>`;
			}
			return returnType;
		}

		// Get all the exported, public members from an API item. Members
		// prefixed by '_', and inherited members, are currently excluded.
		function getExports(entry: ApiData) {
			if (!entry.children) {
				return [];
			}
			return entry.children.filter(
				child =>
					child.flags.isExported &&
					!/^_/.test(child.name) &&
					!child.inheritedFrom
			);
		}

		// Create a heading element at a given level, including an anchor ID.
		function createHeading(level: number, text: string) {
			const heading = document.createElement(`h${level}`);
			heading.appendChild(document.createTextNode(text));
			heading.id = slugify(text);
			return heading;
		}

		// Create a DOM table
		function createTable(headings: string[], rows: string[][]) {
			const table = document.createElement('table');
			table.className = 'table is-bordered';
			const thead = document.createElement('thead');
			table.appendChild(thead);
			const tr = document.createElement('tr');
			tr.innerHTML = `<th>${headings.join('</th><th>')}</th>`;
			thead.appendChild(tr);
			const tbody = document.createElement('tbody');
			table.appendChild(tbody);
			rows.forEach(row => {
				const tr = document.createElement('tr');
				tr.innerHTML = `<td>${row.join('</td><td>')}</td>`;
				tbody.appendChild(tr);
			});
			return table;
		}
	}
}
