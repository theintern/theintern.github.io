interface DocSet {
	url: string;
	latest: string;
	next: string;
	versions: {
		[version: string]: {
			// The project URL
			url: string;
			// The base URL from which the pages should be loaded
			docBase: string;
			// The markdown pages that make up the docset
			pages: string[];
			// A cache of rendered documents
			cache?: { [name: string]: Element };
			// The rendered menu element
			menu?: Element;
		};
	};
}

interface DocSetId {
	project: string;
	version?: string;
}

interface DocInfo {
	project: string;
	version: string;
	page: string;
	section: string;
}

interface MenuNode {
	level: number;
	element: Element;
	children: MenuNode[];
}

declare const markdownitHeadingAnchor: any;
declare const markdownit: any;
declare const docsets: { [name: string]: DocSet };

/**
 * Called when all necessary polyfills have been loaded
 */
function polyfilled() {
	let markdown: any;
	let skipPageLoad = false;
	let defaultDocs = { project: 'Intern' };

	// Super simple router. The location hash fully controls the state of the
	// doc viewer. Changes to the project and version selectors will update the
	// hash, which will cause new content to be rendered.
	window.addEventListener('hashchange', processHash);

	// If the base docs page is loaded (without a hash), set a default hash to
	// get a docset to load.
	if (!location.hash) {
		const docset = getDocset(defaultDocs)!;
		const hash = createHash({
			project: docset.project,
			version: docset.version,
			page: docset.data.pages[0]
		});
		updateHash(hash);
	} else {
		processHash();
	}

	const ready = new Promise(resolve => {
		window.addEventListener('load', resolve);
	});

	ready.then(() => {
		// If the version selector is showing and the user changes it, update
		// the location hash and the docset will be loaded.
		document.querySelector(
			'.docs-nav'
		)!.addEventListener('change', event => {
			const target: Element = <Element>event.target;
			if (target.tagName === 'SELECT') {
				const select = <HTMLSelectElement>target;
				const docs = getCurrentDocs();

				if (target.getAttribute('data-select-property') === 'project') {
					const docset = getDocset({ project: select.value })!.data;
					updateHash(
						createHash({
							project: select.value,
							version: docsets[select.value].latest,
							page: docset.pages[0]
						})
					);
				} else {
					const docset = getDocset({
						project: docs.project,
						version: select.value
					})!.data;
					updateHash(
						createHash({
							project: docs.project,
							version: select.value,
							page: docset.pages[0]
						})
					);
				}
			}
		});

		// Update the highlighted menu item as the user scrolls through the doc content
		let timer: number | undefined;
		const content = document.querySelector('.docs-content')!;
		content.addEventListener('scroll', () => {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(updateMenu, 20);
		});

		function updateMenu() {
			timer = undefined;
			const headings = content.querySelectorAll('h1,h2,h3')!;
			const viewportTop = content.scrollTop;
			for (let i = 0; i < headings.length; i++) {
				const heading = <HTMLElement>headings[i];
				const headingTop = heading.offsetTop;
				if (headingTop > viewportTop) {
					let currentSection = heading;
					if (headingTop - viewportTop > 100) {
						currentSection = <HTMLElement>headings[
							Math.max(i - 1, 0)
						];
					}
					const docs = getCurrentDocs();
					updateHash(
						createHash({
							project: docs.project,
							version: docs.version,
							page: docs.page,
							section: currentSection.id
						}),
						true
					);
					break;
				}
			}
		}

		updateProjectSelector();
	});

	function updateHash(newHash: string, ignoreUpdate = false) {
		if (ignoreUpdate && location.hash !== newHash) {
			skipPageLoad = true;
		}
		location.hash = newHash;
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
		const docBase = docset.data.docBase;

		let cache = docset.data.cache!;
		let load: PromiseLike<any>;

		if (!cache) {
			// The docset hasn't been loaded yet
			cache = docset.data.cache = <{ [name: string]: Element }>{};

			load = Promise.all(
				pageNames.map(name => {
					return (
						cache[name] ||
						fetch(docBase + name)
							.then(response => response.text())
							.then(text => {
								text = filterGhContent(text);
								const html = render(text, name);
								const element = document.createElement('div');
								element.innerHTML = html;
								cache[name] = element;
							})
					);
				})
			).then(() => {
				buildMenu();
			});
		} else {
			// The docset is already loaded
			load = Promise.resolve();
		}

		return Promise.all([ready, load]).then(() => {
			const container = document.querySelector('.docs-content')!;
			container.setAttribute('data-doc-project', docset.project);
			container.setAttribute('data-doc-version', docset.version);

			updateVersionSelector();
			showMenu();
		});

		function buildMenu() {
			const menu = document.createElement('ul');
			menu.className = 'menu-list';
			docset.data.menu = menu;

			pageNames.forEach(pageName => {
				const page = cache[pageName];
				let root: MenuNode;
				try {
					root = createNode(page.querySelector('h1')!);
				} catch (error) {
					root = {
						level: 1,
						element: document.createElement('li'),
						children: []
					};
				}
				const headings = page.querySelectorAll('h2,h3')!;
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

				// If this document's h1 doesn't have any text (maybe it's just an
				// image), assume this is a README, and use the docset's project
				// name as the title.
				const title =
					root.element.textContent! || getCurrentDocs().project;

				const li = createLinkItem(title, pageName);
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

			function createLinkItem(
				text: string,
				pageName: string,
				section?: string
			) {
				const li = document.createElement('li');
				const link = document.createElement('a');
				link.href = createHash({ page: pageName, section });
				link.textContent = text;
				li.appendChild(link);
				return li;
			}

			function createNode(heading: Element) {
				const level = parseInt(heading.tagName.slice(1), 10);
				return { level, element: heading, children: <MenuNode[]>[] };
			}
		}

		function showMenu() {
			const menu = document.querySelector('.docs-nav .menu')!;
			const menuList = menu.querySelector('.menu-list');
			if (menuList) {
				menu.removeChild(menuList);
			}
			menu.appendChild(docset.data.menu!);
		}
	}

	/**
	 * Show a page in the currently loaded docset
	 */
	function showPage(name: string, section?: string) {
		const docset = getDocset()!.data;
		const page = docset.cache![name];
		const content = document.body.querySelector('.docs-content')!;
		content.removeChild(content.children[0]);
		content.appendChild(page);

		if (section) {
			const header = document.querySelector(`#${section}`);
			if (header) {
				header.scrollIntoView();
			}
		} else {
			content.scrollTop = 0;
		}

		updateMenuHighlight();
	}

	/**
	 * Update the active element in the menu
	 */
	function updateMenuHighlight() {
		const menu = document.querySelector('.menu .menu-list')!;
		const active = menu.querySelectorAll('.is-active');
		for (let i = 0; i < active.length; i++) {
			active[i].classList.remove('is-active');
		}

		const currentDocs = getCurrentDocs();
		const currentPage = createHash({
			project: currentDocs.project,
			version: currentDocs.version,
			page: currentDocs.page
		}).slice(1);

		const items = document.querySelectorAll('.menu .menu-list > li > a')!;
		for (let i = 0; i < items.length; i++) {
			const item = <HTMLLinkElement>items[i];
			const hash = item.href.slice(item.href.indexOf('#') + 1);
			if (hash === currentPage) {
				item.classList.add('is-active');
				item.parentElement!.classList.add('is-active');
			}
		}

		const currentSection = location.hash.slice(1);
		const childItems = document.querySelectorAll(
			'.menu .menu-list ul > li > a'
		)!;
		for (let i = 0; i < childItems.length; i++) {
			const item = <HTMLLinkElement>childItems[i];
			const hash = item.href.slice(item.href.indexOf('#') + 1);
			if (hash === currentSection) {
				item.classList.add('is-active');
				item.parentElement!.classList.add('is-active');
			}
		}
	}

	/**
	 * Create a link hash for a given page name and fragment for the current
	 * docset
	 */
	function createHash(info: Partial<DocInfo>) {
		const currentDocs = getCurrentDocs();
		const docs = { ...info };
		if (!docs.project) {
			docs.project = currentDocs.project;
		}
		if (!docs.version) {
			docs.version = currentDocs.version;
		}
		const parts = [docs.project, docs.version, docs.page];
		if (docs.section) {
			parts.push(docs.section);
		}
		return (
			'#' + encodeURIComponent(parts.map(encodeURIComponent).join('/'))
		);
	}

	/**
	 * Remove content that may be in the raw GH pages documents that shouldn't
	 * be rendered.
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
		updateMenuHighlight();

		if (ignoring) {
			return;
		}

		const hash = decodeHash();
		const parts = hash.split('/').map(part => decodeURIComponent(part));
		const project = parts[0];
		const version = parts[1];
		const docset = getDocset({ project, version })!;
		const page = parts[2] || docset.data.pages[0];
		const section = parts[3];

		// The hash encodes our state -- ensure it points to a valid docset
		if (!version) {
			const parts: Partial<DocInfo> = {
				project: docset.project,
				version: docset.version
			};
			if (page) {
				parts.page = page;
			}
			if (section) {
				parts.section = section;
			}
			updateHash(createHash(parts));
		}

		Promise.resolve(loadDocset({ project, version })).then(() => {
			showPage(page, section);
			updateProjectSelector();
			updateVersionSelector();
		});
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

			// Generate heading anchors with the same format as GitHub pages
			// (this isn't terribly robust yet)
			markdown.use(markdownitHeadingAnchor, {
				slugify: (str: string) => {
					return str
						.toLowerCase()
						.replace(/[^A-Za-z0-9_ ]/g, '')
						.replace(/\s+/g, '-');
				}
			});
		}

		return markdown.render(text, { page });
	}

	/**
	 * Select the currently active project in the project selector.
	 */
	function updateProjectSelector() {
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
			`option[value="${getCurrentDocs().project}"]`
		);
		if (option) {
			option.selected = true;
		}
		updateGithubLink();
	}

	/**
	 * Update the version selector to show the versions for the currently
	 * active project.
	 */
	function updateVersionSelector() {
		const docs = getCurrentDocs();
		const versions = Object.keys(docsets[docs.project].versions);
		const layout = document.querySelector('.docs-layout')!;

		// If more than one version is available, show the version selector
		if (versions.length > 1) {
			layout.classList.add('multi-version');

			const selector = document.querySelector(
				'select[data-select-property="version"]'
			)!;
			selector.innerHTML = '';
			versions.forEach(version => {
				const option = document.createElement('option');
				option.value = version;
				option.selected = version === docs.version;
				option.textContent = version;
				selector.appendChild(option);
			});
		} else {
			layout.classList.remove('multi-version');
		}
	}

	/**
	 * Update the github link on the menubar to link to the currently active
	 * project.
	 */
	function updateGithubLink() {
		const link = <HTMLAnchorElement>document.querySelector(
			'.navbar-menu a[data-title="Github"]'
		);
		const docset = getDocset()!.data;
		link.href = docset.url;
	}

	/**
	 * Get the current docset from the location hash
	 */
	function getCurrentDocs(): DocInfo {
		const hash = decodeHash();
		const parts = hash.split('/').map(part => decodeURIComponent(part));
		return {
			project: parts[0],
			version: parts[1],
			page: parts[2],
			section: parts[3]
		};
	}

	/**
	 * Return a decoded version of the hash
	 */
	function decodeHash() {
		return decodeURIComponent(location.hash.slice(1));
	}

	/**
	 * Get a docset. If a complete setId is provided, the corresponding docset
	 * is returned. If only a project is specified, the latest version for that
	 * project will be returned. If no docset ID is provided, the currently
	 * active docset will be returned.
	 */
	function getDocset(setId?: DocSetId) {
		const docs = setId || getCurrentDocs();
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
}
