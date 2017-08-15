declare const markdownitHeadingAnchor: any;
declare const markdownit: any;

interface DocSetCache {
	name: string;
	markdown: string;
	element: HTMLElement;
	html: string;
}

interface DocSet {
	[version: string]: {
		baseUrl: string;
		pages: string[];
		cache?: { [name: string]: DocSetCache; };
	};
}

interface SetId {
	project: string;
	version: string;
}

interface MenuNode {
	level: number;
	element: Element;
	children: MenuNode[];
}

(function() {
	const docsets: { [name: string]: DocSet } = {
		Intern: {
			v3: {
				baseUrl:
					'https://raw.githubusercontent.com/theintern/intern/3.4/',
				pages: ['README.md']
			},
			v4: {
				baseUrl:
					'https://raw.githubusercontent.com/theintern/intern/master/docs/',
				pages: [
					'api.md',
					'getting_started.md',
					'how_to.md',
					'concepts.md'
				]
			}
		},

		'Intern Tutorial': {
			v3: {
				baseUrl:
					'https://raw.githubusercontent.com/theintern/intern-tutorial/master/',
				pages: ['README.md']
			},
			v4: {
				baseUrl:
					'https://raw.githubusercontent.com/theintern/intern-tutorial/intern-3/',
				pages: ['README.md']
			}
		}
	};

	let markdown: any;
	let currentDocs: SetId = { project: 'Intern', version: 'v4' };

	window.addEventListener('hashchange', processHash);
	loadDocset();

	/**
	 * Load a docset, defaulting to `currentDocs`.
	 */
	function loadDocset(setId?: SetId) {
		setId = setId || currentDocs;
		const docset = docsets[setId.project][setId.version];
		const pageNames = docset.pages;
		const baseUrl = docset.baseUrl;
		const cache = (docset.cache = <{ [name: string]: DocSetCache }>{});

		const loads = pageNames.map(function(name) {
			return jQuery.get(baseUrl + name);
		});

		// Render the other pages in the background
		return jQuery.when
			.apply(jQuery, loads)
			.then(function() {
				const args: string[] = Array.prototype.slice.call(arguments);
				const texts = args.map(function(arg) {
					return filterGhContent(arg[0]);
				});

				pageNames.forEach(function(name, idx) {
					const html = render(texts[idx]);
					const element = document.createElement('div');
					element.innerHTML = html;

					cache[name] = {
						name: name,
						markdown: texts[idx],
						element: element,
						html: html
					};
				});

				if (location.hash) {
					processHash();
				} else {
					showPage(pageNames[0]);
				}
			})
			.then(function() {
				currentDocs = setId!;
			});
	}

	/**
	 * Show a new page, optionally re-rendering the menu afterwards
	 */
	function showPage(name: string, section?: string) {
		const docset = docsets[currentDocs.project][currentDocs.version];
		const pages = docset.cache!;
		const page = pages[name];
		const content = document.body.querySelector('.docs-content')!;
		content.innerHTML = '';
		content.appendChild(page.element);

		if (section) {
			document.querySelector('#' + section)!.scrollIntoView();
		} else {
			content.scrollTop = 0;
		}

		buildMenu(name);
	}

	/**
	 * Build the menu, highlighting the given selected page
	 */
	function buildMenu(selectedPage: string) {
		const menu = document.querySelector('.menu-list')!;
		menu.innerHTML = '';

		const docset = docsets[currentDocs.project][currentDocs.version];
		const pageNames = docset.pages;
		const pages = docset.cache!;

		pageNames.forEach(pageName => {
			const page = pages[pageName];
			const headings = page.element.querySelectorAll('h1,h2,h3')!;
			const root = createNode(headings[0]);
			const stack: MenuNode[][] = <MenuNode[][]>[[root]];
			let children: MenuNode[];

			for (let i = 1; i < headings.length; i++) {
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

			const title = root.element.textContent!;
			const li = createLinkItem(title, pageName);
			const pageLink = li.children[0];
			pageLink.setAttribute('data-type', 'page');
			if (selectedPage === pageName) {
				pageLink.className = 'is-active';
				if (root.children.length > 0) {
					li.appendChild(createSubMenu(root.children));
				}
			}

			menu.appendChild(li);

			function createSubMenu(children: MenuNode[]) {
				const ul = document.createElement('ul');
				let child;
				let heading;
				let li;

				for (let i = 0; i < children.length; i++) {
					child = children[i];
					heading = child.element;
					li = createLinkItem(
						heading.textContent!,
						pageName,
						heading.id
					);
					if (child.children.length > 0) {
						li.appendChild(createSubMenu(child.children));
					}
					ul.appendChild(li);
				}

				return ul;
			}
		});

		function createHash(page: string, section?: string) {
			const parts = [currentDocs.project, currentDocs.version, page];
			if (section) {
				parts.push(section);
			}
			return '#' + parts.join('/');
		}

		function createLinkItem(
			text: string,
			pageName: string,
			section?: string
		) {
			const li = document.createElement('li');
			const link = document.createElement('a');
			link.href = createHash(pageName, section);
			link.textContent = text;
			li.appendChild(link);
			return li;
		}

		function createNode(heading: Element) {
			const level = parseInt(heading.tagName.slice(1), 10);
			return { level: level, element: heading, children: <MenuNode[]>[] };
		}
	}

	/**
	 * Remove content that may be in the raw GH pages documents that shouldn't be rendered
	 */
	function filterGhContent(text: string) {
		const markers = [
			/<\!-- vim-markdown-toc[^]*?<!-- vim-markdown-toc -->/,
			/<\!-- start-github-only[^]*?<!-- end-github-only -->/g
		];
		markers.forEach(function(marker) {
			if (marker.test(text)) {
				text = text.replace(marker, '');
			}
		});
		return text;
	}

	/**
	 * Process the current URL hash value.
	 *
	 * The has has the following format:
	 *
	 *     <project>/<version>/<page>/<section>
	 */
	function processHash() {
		const hash = location.hash.slice(1);
		const parts = hash.split('/');
		const project = parts[0];
		const version = parts[1];
		const page = parts[2];
		const section = parts[3];
		let load = null;

		if (
			project !== currentDocs.project ||
			(version != null && version !== currentDocs.version)
		) {
			load = loadDocset({ project: project, version: version });
		}

		jQuery.when(load).then(function() {
			showPage(page, section);
		});
	}

	/**
	 * Render markdown into HTML. Lazily initialize the markdown renderer.
	 */
	function render(text: string) {
		if (!markdown) {
			markdown = markdownit({
				// Customize the syntax highlighting process
				highlight: function(str: string, lang: string) {
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

			// Generate heading anchors with the same format as GitHub pages (this isn't terribly robust yet)
			markdown.use(markdownitHeadingAnchor, {
				slugify: function(str: string) {
					return str
						.toLowerCase()
						.replace(/[^A-Za-z0-9_ ]/g, '')
						.replace(/\s+/g, '-');
				}
			});
		}

		return markdown.render(text);
	}
})();
