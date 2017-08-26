import { ProjectReflection } from 'typedoc';
import { Comment } from 'typedoc/dist/lib/models/comments/comment';
import { SourceReference } from 'typedoc/dist/lib/models/sources/file';
import { DeclarationReflection } from 'typedoc/dist/lib/models/reflections/declaration';
import { SignatureReflection } from 'typedoc/dist/lib/models/reflections/signature';
import { ParameterReflection } from 'typedoc/dist/lib/models/reflections/parameter';
import { ContainerReflection } from 'typedoc/dist/lib/models/reflections/container';
import { Type } from 'typedoc/dist/lib/models/types/abstract';

import { DocSetId, DocPage, getDocSet } from './docs';
import { createHash } from './hash';
import { createGitHubLink, createSlugifier, renderMarkdown, Slugifier } from './render';

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
	const index = createApiIndex(data);

	modules
		.filter(module => {
			return getExports(module).length > 0;
		})
		.forEach(module => {
			const createHeading = getHeadingCreator(createSlugifier());
			const name = module.name.replace(/^"/, '').replace(/"$/, '');
			pages.push(name);
			const element = document.createElement('div');
			const page = (cache[name] = { name, title: name, element });

			element.appendChild(createHeading(1, name));
			renderModule(module, { page, createHeading, index, docSetId });
		});
}

// Render a module page
function renderModule(module: ContainerReflection, context: RenderContext) {
	const { createHeading, page } = context;

	if (hasComment(module.comment)) {
		renderComment(module.comment, context);
	}

	const exports = getExports(module);

	const classes = exports.filter(ex => ex.kindString === 'Class');
	if (classes.length > 0) {
		page.element.appendChild(createHeading(2, 'Classes'));
		classes.forEach(cls => {
			renderClass(cls, context);
		});
	}

	const interfaces = exports.filter(ex => ex.kindString === 'Interface');
	if (interfaces.length > 0) {
		page.element.appendChild(createHeading(2, 'Interfaces'));
		interfaces.forEach(iface => {
			renderInterface(iface, context);
		});
	}

	const functions = exports.filter(ex => ex.kindString === 'Function');
	if (functions.length > 0) {
		page.element.appendChild(createHeading(2, 'Functions'));
		functions.forEach(func => {
			renderFunction(func, context);
		});
	}

	const constants = exports.filter(ex => ex.kindString === 'Object literal');
	if (constants.length > 0) {
		page.element.appendChild(createHeading(2, 'Constants'));
		constants.forEach(constant => {
			renderLiteral(constant, context);
		});
	}
}

// Render a class
function renderClass(cls: DeclarationReflection, context: RenderContext) {
	const { page, createHeading } = context;
	const heading = createHeading(3, cls.name);
	page.element.appendChild(heading);

	if (cls.sources) {
		const link = createSourceLink(cls.sources[0], context)!;
		if (link) {
			heading.appendChild(link);
		}
	}

	if (cls.extendedTypes) {
		renderExtends(cls.extendedTypes, context);
	}

	if (hasComment(cls.comment)) {
		renderComment(cls.comment, context);
	}

	const exports = getExports(cls);

	const properties = exports.filter(ex => ex.kindString === 'Property');
	properties.forEach(property => {
		renderProperty(property, context);
	});
	const methods = exports.filter(
		ex => ex.kindString === 'Method' || ex.kindString === 'Constructor'
	);
	methods.forEach(method => {
		renderMethod(method, context);
	});
}

// Render a class method
function renderMethod(method: DeclarationReflection, context: RenderContext) {
	renderFunction(method, context, 4);
}

// Render a class or interface inheritance chain
function renderExtends(types: Type[], context: RenderContext) {
	for (let type of types) {
		const p = document.createElement('p');
		p.className = 'api-metadata';

		const span = document.createElement('span');
		span.className = 'api-label';
		span.textContent = 'Extends';
		p.appendChild(span);

		p.appendChild(renderType(type, context));

		context.page.element.appendChild(p);
	}
}

// Render a TypeScript interface
function renderInterface(iface: DeclarationReflection, context: RenderContext) {
	const { page, createHeading } = context;
	const heading = createHeading(3, iface.name);
	page.element.appendChild(heading);

	if (iface.sources) {
		const link = createSourceLink(iface.sources[0], context);
		if (link) {
			heading.appendChild(link);
		}
	}

	if (iface.extendedTypes) {
		renderExtends(iface.extendedTypes, context);
	}

	if (hasComment(iface.comment)) {
		renderComment(iface.comment, context);
	}

	if (iface.signatures) {
		page.element.appendChild(createHeading(4, 'Call signatures'));
		renderSignatures(iface.signatures, context);
	}

	const exports = getExports(iface);

	const properties = exports.filter(ex => ex.kindString === 'Property');
	properties.forEach(property => {
		renderProperty(property, context);
	});

	const methods = exports.filter(
		ex => ex.kindString === 'Method' || ex.kindString === 'Constructor'
	);
	methods.forEach(method => {
		renderMethod(method, context);
	});
}

// Render a class or interface property
function renderProperty(
	property: DeclarationReflection,
	context: RenderContext
) {
	const { page, createHeading } = context;
	const heading = createHeading(4, property.name);
	page.element.appendChild(heading);

	if (property.sources) {
		const link = createSourceLink(property.sources[0], context);
		if (link) {
			heading.appendChild(link);
		}
	}

	const text = `${property.name}: ${typeToString(property.type!)}`;
	renderCode(text, page);

	if (hasComment(property.comment)) {
		renderComment(property.comment, context);
	}
}

// Render an exported function
function renderFunction(
	func: DeclarationReflection,
	context: RenderContext,
	level = 3
) {
	const { page, createHeading } = context;
	const heading = createHeading(level, func.name);
	page.element.appendChild(heading);

	if (func.sources) {
		const link = createSourceLink(func.sources[0], context);
		if (link) {
			heading.appendChild(link);
		}
	}

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
function renderLiteral(value: DeclarationReflection, context: RenderContext) {
	const { page, createHeading } = context;
	page.element.appendChild(createHeading(3, value.name));
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
		const source = context.index[type.id].sources[0].fileName.replace(/\.ts$/, '');
		link.href = createHash({
			page: source,
			type: 'api'
		});
		link.textContent = type.name;
		returnType.appendChild(link);
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

// Get all the exported, public members from an API item. Members
// prefixed by '_', and inherited members, are currently excluded.
function getExports(entry: ContainerReflection) {
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
function getHeadingCreator(slugify: Slugifier) {
	return (level: number, text: string) => {
		const heading = document.createElement(`h${level}`);
		heading.appendChild(document.createTextNode(text));
		heading.id = slugify(text);
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

function createApiIndex(data: ProjectReflection) {
	const index: ApiIndex = {};
	data.children.forEach(child => {
		walkTree(child);
	});
	return index;

	function walkTree(data: DeclarationReflection) {
		index[data.id] = data;
		if (data.children) {
			data.children.forEach(child => {
				walkTree(child);
			});
		}
	}
}

type ApiIndex = { [key: number]: DeclarationReflection };

interface RenderContext {
	page: DocPage;
	createHeading: (level: number, text: string) => HTMLElement;
	index: ApiIndex;
	docSetId: DocSetId;
}
