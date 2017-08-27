import { ProjectReflection } from 'typedoc';
import { Comment } from 'typedoc/dist/lib/models/comments/comment';
import { SourceReference } from 'typedoc/dist/lib/models/sources/file';
import { DeclarationReflection } from 'typedoc/dist/lib/models/reflections/declaration';
import { SignatureReflection } from 'typedoc/dist/lib/models/reflections/signature';
import { ParameterReflection } from 'typedoc/dist/lib/models/reflections/parameter';
import { ContainerReflection } from 'typedoc/dist/lib/models/reflections/container';
import { Reflection } from 'typedoc/dist/lib/models/reflections/abstract';
import { Type } from 'typedoc/dist/lib/models/types/abstract';

import { DocSetId, DocPage, getDocSet } from './docs';
import { createHash } from './hash';
import {
	addHeadingIcons,
	createGitHubLink,
	createSlugifier,
	renderMarkdown,
	Slugifier
} from './render';

/**
 * Render the API pages for a docset
 */
export function renderApiPages(docSetId: DocSetId, data: ProjectReflection) {
	const docset = getDocSet(docSetId)!;
	const docs = docset.docs;
	const pages = (docs.apiPages = <string[]>[]);
	const cache = (docs.apiCache = <{
		[key: string]: DocPage;
	}>Object.create(null));
	const modules = getExports(data)!;
	const apiIndex = createApiIndex(data);
	const slugIndex: SlugIndex = {};
	const pageIndex: { [id: number]: string } = {};
	const linksToResolve: { link: HTMLAnchorElement; id: number }[] = [];

	modules
		.filter(module => {
			// Only show modules that have exports
			return getExports(module).length > 0;
		})
		.forEach(module => {
			const renderHeading = getHeadingRenderer(createSlugifier());
			const name = module.name.replace(/^"/, '').replace(/"$/, '');
			pages.push(name);
			pageIndex[module.id] = name;

			const element = document.createElement('div');
			const page = (cache[name] = { name, title: name, element });
			const context: RenderContext = {
				page,
				renderHeading,
				api: data,
				apiIndex,
				slugIndex,
				docSetId,
				linksToResolve
			};

			renderModule(module, 1, context);
		});

	for (let { link, id } of linksToResolve) {
		const type = apiIndex[id];
		const module = findModule(id, apiIndex);

		if (module === type) {
			link.href = createHash({
				page: pageIndex[module.id],
				type: 'api'
			});
		} else {
			link.href = createHash({
				page: pageIndex[module.id],
				section: slugIndex[type.id],
				type: 'api'
			});
		}
	}
}

// Render a module page
function renderModule(module: ContainerReflection, level: number, context: RenderContext) {
	const { renderHeading, slugIndex } = context;
	const heading = renderHeading(level, module, context);
	slugIndex[module.id] = heading.id;

	if (hasComment(module.comment)) {
		renderComment(module.comment, context);
	}

	const exports = getExports(module);

	const global = exports.filter(ex => ex.name === '__global')[0];
	if (global) {
		renderGlobals(global, level, context);
	}

	const classes = exports.filter(ex => ex.kindString === 'Class');
	if (classes.length > 0) {
		classes.forEach(cls => {
			renderClass(cls, level + 1, context);
		});
	}

	const interfaces = exports.filter(ex => ex.kindString === 'Interface');
	if (interfaces.length > 0) {
		interfaces.forEach(iface => {
			renderInterface(iface, level + 1, context);
		});
	}

	const functions = exports.filter(ex => ex.kindString === 'Function');
	if (functions.length > 0) {
		functions.forEach(func => {
			renderFunction(func, level + 1, context);
		});
	}

	const constants = exports.filter(ex => ex.kindString === 'Object literal');
	if (constants.length > 0) {
		constants.forEach(constant => {
			renderLiteral(constant, level + 1, context);
		});
	}
}

// Render global variables
function renderGlobals(global: DeclarationReflection, level: number, context: RenderContext) {
	const { renderHeading } = context;
	renderHeading(level, 'Globals', context);

	for (let child of global.children) {
		renderProperty(child, level + 1, context);
	}
}

// Render a class
function renderClass(cls: DeclarationReflection, level: number, context: RenderContext) {
	const { renderHeading, slugIndex } = context;
	const heading = renderHeading(level, cls, context);
	slugIndex[cls.id] = heading.id;

	if (cls.extendedTypes) {
		renderParent(cls.extendedTypes, Relationship.Extends, context);
	}

	if (hasComment(cls.comment)) {
		renderComment(cls.comment, context);
	}

	const exports = getExports(cls);

	const properties = exports.filter(ex => ex.kindString === 'Property');
	properties.forEach(property => {
		renderProperty(property, level + 1, context);
	});
	const methods = exports.filter(
		ex => ex.kindString === 'Method' || ex.kindString === 'Constructor'
	);
	methods.forEach(method => {
		renderMethod(method, level + 1, context);
	});
}

// Render a class method
function renderMethod(method: DeclarationReflection, level: number, context: RenderContext) {
	renderFunction(method, level + 1, context);
}

// Render a class or interface inheritance chain
function renderParent(
	types: Type[],
	relationship: Relationship,
	context: RenderContext
) {
	for (let type of types) {
		const p = document.createElement('p');
		p.className = 'api-metadata';

		const span = document.createElement('span');
		span.className = 'api-label';
		span.textContent = `${relationship}: `;
		p.appendChild(span);

		p.appendChild(renderType(type, context));

		context.page.element.appendChild(p);
	}
}

// Render a TypeScript interface
function renderInterface(iface: DeclarationReflection, level: number, context: RenderContext) {
	const { renderHeading, slugIndex } = context;
	const heading = renderHeading(level, iface, context);
	slugIndex[iface.id] = heading.id;

	if (iface.extendedTypes) {
		renderParent(iface.extendedTypes, Relationship.Extends, context);
	}

	if (hasComment(iface.comment)) {
		renderComment(iface.comment, context);
	}

	if (iface.signatures) {
		renderHeading(level + 1, 'Call signatures', context);
		renderSignatures(iface.signatures, context);
	}

	const exports = getExports(iface);

	const properties = exports.filter(ex => ex.kindString === 'Property');
	properties.forEach(property => {
		renderProperty(property, level + 1, context);
	});

	const methods = exports.filter(
		ex => ex.kindString === 'Method' || ex.kindString === 'Constructor'
	);
	methods.forEach(method => {
		renderMethod(method, level + 1, context);
	});
}

// Render a class or interface property
function renderProperty(
	property: DeclarationReflection,
	level: number,
	context: RenderContext
) {
	const { page, renderHeading, slugIndex } = context;
	const heading = renderHeading(level, property, context);
	slugIndex[property.id] = heading.id;

	if (property.inheritedFrom) {
		renderParent([property.inheritedFrom], Relationship.Inherited, context);
	}

	const text = `${property.name}: ${typeToString(property.type!)}`;
	renderCode(text, page);

	if (hasComment(property.comment)) {
		renderComment(property.comment, context);
	}
}

/**
 * Render an exported function
 */
function renderFunction(
	func: DeclarationReflection,
	level: number,
	context: RenderContext
) {
	const { renderHeading, slugIndex } = context;
	const heading = renderHeading(level, func, context);
	slugIndex[func.id] = heading.id;

	renderSignatures(func.signatures!, context);

	for (let signature of func.signatures!) {
		if (hasComment(signature.comment)) {
			renderComment(signature.comment, context);
			break;
		}
	}
}

// Render a function/method signature
function renderSignatures(
	signatures: SignatureReflection[],
	context: RenderContext
) {
	const { page } = context;
	for (let sig of signatures) {
		const container = document.createElement('p');
		const text = hljs.highlight('typescript', signatureToString(sig), true)
			.value;
		const code = document.createElement('code');
		code.className = 'hljs lang-typescript';
		code.innerHTML = text;
		container.appendChild(code);
		page.element.appendChild(container);
	}

	const parameters = signatures.reduce((params, sig) => {
		return params.concat(sig.parameters || []);
	}, <ParameterReflection[]>[]);
	if (parameters.length > 0) {
		renderParameterTable(parameters, context);
	}
}

// Render a table of signature parameters
function renderParameterTable(
	parameters: ParameterReflection[],
	context: RenderContext
) {
	const { page } = context;
	const params = parameters.filter(param => {
		return hasComment(param.comment) || param.defaultValue;
	});

	if (params.length > 0) {
		const rows = params.map(param => {
			const comment =
				hasComment(param.comment) &&
				commentToHtml(param.comment, page.name);
			return [param.name, comment || '', param.defaultValue || ''];
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
function renderLiteral(value: DeclarationReflection, level: number, context: RenderContext) {
	const { page, renderHeading, slugIndex } = context;
	const heading = renderHeading(level, value, context);
	slugIndex[value.id] = heading.id;

	if (value.kindString === 'Object literal') {
		const parts = value.children.map(child => {
			if (child.name) {
				return `${child.name}: ${child.defaultValue}`;
			}
			return child.defaultValue;
		});
		let type = typeToString(value.type!);
		type = type === 'object' ? '' : `: ${type}`;
		const text = `${value.name}${type} = {\n\t${parts.join(',\n\t')}\n}`;
		renderCode(text, page);
	}
}

// Render an element comment
function renderComment(comment: Comment, context: RenderContext) {
	const { page } = context;
	const p = document.createElement('p');
	p.innerHTML = commentToHtml(comment, page.name);
	page.element.appendChild(p);
}

// Generate HTML for an API comment
function commentToHtml(comment: Comment, pageName: string) {
	let parts: string[] = [];

	if (comment.shortText) {
		parts.push(renderText(comment.shortText));
	}

	if (comment.text) {
		parts.push(renderText(comment.text));
	}

	return parts.join('');

	function renderText(text: string) {
		// Fix jsdoc-style links
		text = text.replace(/\[\[(.*?)]]/g, '[$1]($1)');
		return renderMarkdown(text, { info: { page: pageName, type: 'api' } });
	}
}

// Render a syntax-highlighted block of code
function renderCode(text: string, page: DocPage, language = 'typescript') {
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
function createSourceLink(source: SourceReference, context: RenderContext) {
	// Don't try to create links for files with absolute paths
	if (source.fileName[0] === '/') {
		return;
	}

	const link = createGitHubLink(
		{
			project: context.docSetId.project,
			version: context.docSetId.version!
		},
		`src/${source.fileName}#L${source.line}`
	);
	link.title = `${source.fileName}#L${source.line}`;
	return link;
}

// Generate a string representation of a function/method signature
function signatureToString(
	signature: SignatureReflection,
	isParameter = false
): string {
	const name = signature.name === '__call' ? '' : signature.name;
	let text = `${name}(`;
	if (signature.parameters) {
		const params = signature.parameters.map(param => {
			const optional = param.flags.isOptional ? '?' : '';
			return `${param.name}${optional}: ${typeToString(param.type)}`;
		});
		text += params.join(', ');
	}

	let returnType = typeToString(signature.type);

	const sep = isParameter ? ' => ' : ': ';
	text += `)${sep}${returnType}`;

	return text;
}

// Generate a string representation of a type
// TODO: Should be Type?
function typeToString(type: any): string {
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
				const parts = d.children.map((child: any) => {
					return `${child.name}: ${typeToString(
						child.type || child.kindString
					)}`;
				});
				return `{ ${parts.join(', ')} }`;
			} else if (d.signatures) {
				return signatureToString(d.signatures[0], true);
			}
		}
	}

	let returnType = type.name!;
	if (type.typeArguments) {
		const args = type.typeArguments.map((arg: any) => {
			return typeToString(arg);
		});
		returnType += `<${args.join(', ')}>`;
	}

	return returnType;
}

// Render a type to a DOM node
function renderType(type: any, context: RenderContext): HTMLElement {
	if (type.type === 'stringLiteral') {
		const node = document.createElement('span');
		node.className = 'type-literal';
		node.textContent = type.value;
		return node;
	} else if (type.type === 'union') {
		const nodes = type.types!.map(renderType);
		const container = document.createElement('span');
		container.className = 'type-union';
		for (let node of nodes) {
			container.appendChild(node);
		}
		return container;
	} else if (type.type === 'array') {
		const node = renderType(type.elementType!, context);
		node.classList.add('type-array');
		return node;
	} else if (type.type === 'reflection') {
		const d = type.declaration!;
		if (d.kindString === 'Type literal') {
			if (d.children) {
				const parts = d.children.map((child: any) => {
					const node = document.createElement('span');
					const label = document.createElement('span');
					label.className = 'type-label';
					label.textContent = child.name;
					node.appendChild(label);

					const typeNode = renderType(child.type, context);
					node.appendChild(typeNode);
					return node;
				});

				const container = document.createElement('span');
				container.className = 'type-list';
				for (let part of parts) {
					container.appendChild(part);
				}
				return container;
			} else if (d.signatures) {
				const node = document.createElement('span');
				node.className = 'type-signature';
				node.innerHTML = signatureToString(d.signatures[0], true);
				return node;
			}
		}
	}

	const returnType = document.createElement('span');
	if (type.type === 'reference' && type.id != null) {
		const link = document.createElement('a');
		link.textContent = type.name;
		returnType.appendChild(link);

		// Push this link onto the list to be resolved later, once all the
		// slugs have been generated
		context.linksToResolve.push({
			link,
			id: type.id
		});
	} else {
		returnType.appendChild(document.createTextNode(type.name));
	}

	if (type.typeArguments) {
		const args = type.typeArguments.map((arg: any) => {
			return renderType(arg, context);
		});
		const container = document.createElement('span');
		container.className = 'type-list type-arg';
		for (let arg of args) {
			container.appendChild(arg);
		}
		returnType.appendChild(container);
	}

	return returnType;
}

/**
 * Find the module that contains a given declaration ID
 */
function findModule(id: number, index: ApiIndex) {
	let declaration = <Reflection>index[id];
	while (declaration && declaration.kindString !== 'External module') {
		declaration = declaration.parent;
	}
	return declaration;
}

/**
 * Get all the exported, public members from an API item. Members
 * prefixed by '_', and inherited members, are currently excluded.
 */
function getExports(entry: ContainerReflection) {
	if (!entry.children) {
		return [];
	}
	return entry.children.filter(
		child =>
			(child.flags.isExported &&
				// Don't include private (by convention) members
				!/^_/.test(child.name)) ||
			child.name === '__global'
	);
}

// Create a heading element at a given level, including an anchor ID.
function getHeadingRenderer(slugify: Slugifier) {
	return (
		level: number,
		content: Reflection | string,
		context: RenderContext
	) => {
		const heading = document.createElement(`h${level}`);

		let type: string | undefined;
		if (typeof content !== 'string') {
			type = content.kindString;
		} else if (content === 'Call signatures') {
			type = 'Function';
		}

		if (type) {
			heading.classList.add('is-type');
		}

		if (type === 'Method' || type === 'Function') {
			heading.classList.add('is-type-callable');
		} else if (type === 'Property') {
			heading.classList.add('is-type-property');
		} else if (type === 'Constructor') {
			heading.classList.add('is-type-constructor');
		} else if (type === 'Class') {
			heading.classList.add('is-type-class');
		} else if (type === 'Interface') {
			heading.classList.add('is-type-interface');
		}

		const text =
			typeof content === 'string'
				? content
				// Module names are surrounded by '"'
				: content.name.replace(/^"|"$/g, '');
		heading.appendChild(document.createTextNode(text));
		heading.id = slugify(text);

		let sourceLink: HTMLAnchorElement | undefined;
		if (typeof content !== 'string' && content.sources) {
			sourceLink = createSourceLink(content.sources[0], context);
		}

		if (sourceLink) {
			const icons = addHeadingIcons(heading);
			icons.appendChild(sourceLink);
		}

		context.page.element.appendChild(heading);

		return heading;
	};
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

function hasComment(comment: Comment) {
	return comment && (comment.text || comment.shortText);
}

/**
 * Create an index of TypeDoc declaration IDs to data structures. This function
 * also creates parent relationships.
 */
function createApiIndex(data: ProjectReflection) {
	const index: ApiIndex = {};
	data.children.forEach(child => {
		child.parent = data;
		walkTree(child);
	});
	return index;

	function walkTree(data: DeclarationReflection) {
		index[data.id] = data;
		if (data.children) {
			data.children.forEach(child => {
				child.parent = data;
				walkTree(child);
			});
		}
	}
}

type ApiIndex = { [key: number]: DeclarationReflection };
type SlugIndex = { [key: number]: string };

interface HeadingRenderer {
	(
		level: number,
		content: Reflection | string,
		context: RenderContext
	): HTMLElement;
}

interface RenderContext {
	page: DocPage;
	renderHeading: HeadingRenderer;
	apiIndex: ApiIndex;
	slugIndex: SlugIndex;
	api: ProjectReflection;
	docSetId: DocSetId;
	linksToResolve: { link: HTMLAnchorElement; id: number }[];
}

enum Relationship {
	Extends = 'Extends',
	Inherited = 'Inherited from'
}
