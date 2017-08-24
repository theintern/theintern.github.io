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

interface DocSet {
	url: string;
	latest: string;
	next: string;
	versions: { [version: string]: DocSetVersion };
}

/**
 * Details for a specific version of a docset. If a branch is specified but url
 * or docBase are not, they will be constructed using the standard GitHub URL
 * format.
 */
interface DocSetVersion {
	// The base URL for the docset
	url?: string;
	// The base URL from which the pages should be loaded
	docBase?: string;
	// The branch or tag in the repo where docs will be loaded from.
	branch?: string;
	// The markdown pages that make up the docset
	pages: string[];
	// A cache of rendered documents
	cache?: { [name: string]: DocPage };
	// The rendered menu element
	menu?: Element;
}

interface DocPage {
	element: Element;
	title: string;
}

interface DocSetId {
	project: string;
	version?: string;
}

interface DocSetInfo {
	project: string;
	version: string;
	data: DocSetVersion;
}

interface DocInfo {
	project: string;
	version: string;
	type: 'docs' | 'api';
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

	const defaultDocs = { project: 'Intern' };
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
			page: docset.data.pages[0]
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
			const docs = getCurrentDocset();

			if (target.getAttribute('data-select-property') === 'project') {
				docs.page = getDocset({
					project: select.value
				})!.data.pages[0];
				docs.project = select.value;
				docs.version = docsets[select.value].latest;
			} else {
				docs.page = getDocset({
					project: docs.project,
					version: select.value
				})!.data.pages[0];
				docs.version = select.value;
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

		// After the page is loaded, ensure the docset selector reflects what's
		// being displayed.
		updateDocsetSelector();
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
			return;
		}

		const pageNames = docset.data.pages;
		const docBase = getDocBaseUrl(docset);

		let cache = docset.data.cache!;
		let load: PromiseLike<any>;

		if (!cache) {
			// The docset hasn't been loaded yet
			cache = docset.data.cache = <{ [name: string]: DocPage }>{};

			load = Promise.all(
				pageNames.map(name => {
					return fetch(docBase + name)
						.then(response => response.text())
						.then(text => {
							return ready.then(() => {
								text = filterGhContent(text);
								const html = render(text, name);
								const element = document.createElement('div');
								element.innerHTML = html;

								const heading = document.createElement('div');
								heading.className = 'page-heading';

								const h1 = element.querySelector('h1')!;
								heading.appendChild(h1);
								element.insertBefore(
									heading,
									element.firstChild
								);

								heading.appendChild(
									createGitHubLink(docset, name)
								);
								const title =
									(h1 && h1.textContent) || docset.project;
								cache[name] = { element, title };
							});
						});
				})
			).then(() => {
				// All pages need to have been loaded to create the docset menu
				createMenu();
			});
		} else {
			// The docset is already loaded
			load = Promise.resolve();
		}

		// When both the docset and the page are ready, update the UI
		return Promise.all([ready, load]).then(() => {
			const container = document.querySelector('.docs-content')!;
			container.setAttribute('data-doc-project', docset.project);
			container.setAttribute('data-doc-version', docset.version);

			updateDocsetSelector();
			showMenu();
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

		// Create the sidebar menu for a page
		function createMenu() {
			const menu = document.createElement('ul');
			menu.className = 'menu-list';
			docset.data.menu = menu;

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
				const headings = page.element.querySelectorAll('h2,h3')!;
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

				const li = createLinkItem(page.title, pageName);
				if (root.children.length > 0) {
					li.appendChild(createSubMenu(root.children, pageName));
				}

				menu.appendChild(li);
			});

			function createSubMenu(children: MenuNode[], pageName: string) {
				const ul = document.createElement('ul');

				children.forEach(child => {
					const heading = child.element;
					const li = createLinkItem(
						heading.textContent!,
						pageName,
						heading.id
					);
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

		// Install the current docset's menu in the menu container
		function showMenu() {
			const menu = document.querySelector('.docs-menu .menu')!;
			const menuList = menu.querySelector('.menu-list');
			if (menuList) {
				menu.removeChild(menuList);
			}
			menu.appendChild(docset.data.menu!);
		}
	}

	/**
	 * Create a link item for a menu
	 */
	function createLinkItem(text: string, pageName: string, section?: string) {
		const li = document.createElement('li');
		const link = document.createElement('a');
		link.href = createHash({ page: pageName, section });
		link.textContent = text;
		link.title = text;
		li.appendChild(link);
		return li;
	}

	/**
	 * Show a page in the currently loaded docset
	 */
	function showPage(name: string, section?: string) {
		const docset = getDocset()!.data;
		const page = docset.cache![name];
		const content = <HTMLElement>document.body.querySelector(
			'.docs-content'
		)!;
		content.removeChild(content.children[0]);
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
	 * Highlight the active page in the sidebar menu
	 */
	function highlightActivePage() {
		const menu = document.querySelector('.docs-menu .menu .menu-list')!;
		const active = menu.querySelector('.is-active-page');
		if (active) {
			active.classList.remove('is-active-page');
		}

		const currentDocs = getCurrentDocset();
		const currentPage = createHash({
			project: currentDocs.project,
			version: currentDocs.version,
			type: currentDocs.type,
			page: currentDocs.page
		});

		const pageLink = menu.querySelector(`li > a[href="${currentPage}"]`)!;
		pageLink.parentElement!.classList.add('is-active-page');
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
			const currentDocs = getCurrentDocset();
			const currentPage = createHash({
				project: currentDocs.project,
				version: currentDocs.version,
				page: currentDocs.page
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
				version: docset.version
			};
			if (hash.page) {
				parts.page = hash.page;
			}
			if (hash.section) {
				parts.section = hash.section;
			}
			setHash(parts);
		} else {
			Promise.resolve(loadDocset(hash)).then(() => {
				viewer.setAttribute('data-doc-type', hash.type);
				showPage(hash.page, hash.section);
				updateDocsetSelector();
			});
		}
	}

	/**
	 * Render markdown into HTML. Lazily initialize the markdown renderer.
	 */
	function render(text: string, page?: string) {
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
				} else if (/\.md/.test(file) && !/\/\//.test(file)) {
					// This is a link to a local markdown file. Make a hash
					// link that's relative to the current page.
					const cleanFile = file.replace(/^\.\//, '');
					let pageBase = '';
					if (env.page.indexOf('/') !== -1) {
						pageBase = env.page.slice(
							0,
							env.page.lastIndexOf('/') + 1
						);
					}
					href[1] = createHash({
						page: pageBase + cleanFile,
						section: hash
					});
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
	 * Select the currently active project in the project selector.
	 */
	function updateDocsetSelector() {
		const docs = getCurrentDocset();
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
			`option[value="${getCurrentDocset().project}"]`
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

	/**
	 * Get the current docset from the location hash. If the hash does not
	 * identify a page, use default values.
	 */
	function getCurrentDocset(): DocInfo {
		const data = parseHash();
		if (!data.project) {
			data.project = defaultDocs.project;
		}
		if (!data.version) {
			data.version = docsets[data.project].latest;
		}
		if (!data.page) {
			data.page = docsets[data.project].versions[data.version].pages[0];
		}
		if (!data.type) {
			data.type = 'docs';
		}
		return data;
	}

	/**
	 * Create a link hash for a given docset.
	 */
	function createHash(info: Partial<DocInfo>) {
		const currentDocs = getCurrentDocset();
		const docs = {
			project: currentDocs.project,
			version: currentDocs.version,
			type: 'docs',
			...info
		};
		const parts = [docs.project, docs.version, docs.type, docs.page];
		if (docs.section) {
			parts.push(docs.section);
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
		const docs = setId || getCurrentDocset();
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
			data: project.versions[docs.version]
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
		for (let name of docset.data.pages) {
			const page = docset.data.cache![name];
			finders.push(
				findAllMatches(page.element).then(matches => {
					if (matches.length > 0) {
						const link = createLinkItem(page.title, name);
						searchResults.appendChild(link);

						const submenu = document.createElement('ul');
						link.appendChild(submenu);

						matches.forEach(match => {
							const link = createLinkItem(
								match.snippet,
								name,
								match.section
							);
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

		const docs = getCurrentDocset();
		setHash(
			{
				project: docs.project,
				version: docs.version,
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

		const span = document.createElement('span');
		span.className = 'icon';
		const icon = document.createElement('i');
		icon.className = 'fa fa-file-text-o';
		span.appendChild(icon);
		link.appendChild(span);

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
}
