import { ProjectReflection } from 'typedoc';
import { Comment } from 'typedoc/dist/lib/models/comments/comment';
import { SourceReference } from 'typedoc/dist/lib/models/sources/file';
import { DeclarationReflection } from 'typedoc/dist/lib/models/reflections/declaration';
import { SignatureReflection } from 'typedoc/dist/lib/models/reflections/signature';
import { ParameterReflection } from 'typedoc/dist/lib/models/reflections/parameter';
import { ContainerReflection } from 'typedoc/dist/lib/models/reflections/container';
import { TypeParameterReflection } from 'typedoc/dist/lib/models/reflections/type-parameter';
import { Reflection } from 'typedoc/dist/lib/models/reflections/abstract';
import { Type } from 'typedoc/dist/lib/models/types/abstract';
import { StringLiteralType } from 'typedoc/dist/lib/models/types/string-literal';
import { TypeParameterType } from 'typedoc/dist/lib/models/types/type-parameter';
import { UnionType } from 'typedoc/dist/lib/models/types/union';
import { ArrayType } from 'typedoc/dist/lib/models/types/array';
import { ReflectionType } from 'typedoc/dist/lib/models/types/reflection';
import { ReferenceType } from 'typedoc/dist/lib/models/types/reference';
import { IntrinsicType } from 'typedoc/dist/lib/models/types/intrinsic';
import { UnknownType } from 'typedoc/dist/lib/models/types/unknown';
import * as h from 'hyperscript';

interface GenericReflection extends Reflection {
	typeParameter: TypeParameterReflection[];
}

import { DocSetId, DocPage, DocType, getDocSet } from './docs';
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
	const docSet = getDocSet(docSetId)!;
	const pages = (docSet.apiPages = <string[]>[]);
	const cache = (docSet.apiCache = <{
		[key: string]: DocPage;
	}>Object.create(null));
	const modules = getExports(data)!;
	const apiIndex = createApiIndex(data);
	const slugIndex: SlugIndex = {};
	const pageIndex: { [id: number]: string } = {};
	const linksToResolve: { link: HTMLAnchorElement; id: number }[] = [];
	const nameRefs: NameRefs = Object.create(null);

	for (const module of modules) {
		if (getExports(module).length === 0 && !hasComment(module)) {
			// Only show modules that have exports
			continue;
		}

		const renderHeading = getHeadingRenderer(createSlugifier());
		const name = module.name.replace(/^"/, '').replace(/"$/, '');
		pages.push(name);
		pageIndex[module.id] = name;

		const element = h('div');
		const page = (cache[name] = { name, title: name, element });
		const context: RenderContext = {
			page,
			renderHeading,
			api: data,
			apiIndex,
			slugIndex,
			docSetId,
			linksToResolve,
			nameRefs
		};

		renderModule(module, 1, context);
	}

	// Fixup other links
	for (const { link, id } of linksToResolve) {
		const type = apiIndex[id];
		if (id === -1) {
			continue;
		}
		const module = findModule(id, apiIndex);

		if (module === type) {
			link.href = createHash({
				page: pageIndex[module.id],
				type: DocType.api,
				...docSetId
			});
		} else {
			link.href = createHash({
				page: pageIndex[module.id],
				section: slugIndex[type.id],
				type: DocType.api,
				...docSetId
			});
		}
	}
}

/**
 * Get the module containing a given reflection
 */
function getContainingModule(reflection: Reflection) {
	while (reflection && reflection.kindString !== 'External module') {
		reflection = reflection.parent;
	}
	return <ContainerReflection>reflection;
}

/**
 * Return the reflection ID corresponding to a given name.
 */
function getReflectionIdForName(
	name: string,
	context: RenderContext,
	_module: ContainerReflection
) {
	const { nameRefs } = context;
	if (!(name in nameRefs)) {
		const reflection = findReflectionByName(name, context.api);
		nameRefs[name] = reflection ? reflection.id : -1;
	}
	return nameRefs[name];
}

/**
 * Recursively find a reflection in the API by dot-separated name
 */
function findReflectionByName(
	name: string,
	reflection: Reflection
): Reflection | undefined {
	let head = name;
	let dot = head.indexOf('.');
	if (dot !== -1) {
		head = head.slice(0, dot);
	}

	if (isContainerReflection(reflection)) {
		for (const child of reflection.children) {
			const childName = child.name.replace(/^"|"$/g, '');
			if (childName === head) {
				if (head !== name) {
					const tail = name.slice(dot + 1);
					return findReflectionByName(tail, child);
				} else {
					return child;
				}
			}
		}
	}

	return;
}

/**
 * Render a module page
 */
function renderModule(
	module: ContainerReflection,
	level: number,
	context: RenderContext
) {
	const { renderHeading, slugIndex, page } = context;
	const heading = renderHeading(level, module, context);
	slugIndex[module.id] = heading.id;

	if (hasComment(module)) {
		page.element.appendChild(
			renderComment(module.comment, module, context)
		);
	}

	const exports = getExports(module);

	const global = exports.filter(ex => ex.name === '__global')[0];
	if (global) {
		renderHeading(level, 'Globals', context);
		for (const child of global.children.slice().sort(nameSorter)) {
			renderProperty(child, level + 1, context);
		}
	}

	const classes = exports
		.filter(ex => ex.kindString === 'Class')
		.sort(nameSorter);
	for (const cls of classes) {
		renderClass(cls, level + 1, context);
	}

	const interfaces = exports
		.filter(ex => ex.kindString === 'Interface')
		.sort(nameSorter);
	for (const iface of interfaces) {
		renderInterface(iface, level + 1, context);
	}

	const functions = exports
		.filter(ex => ex.kindString === 'Function')
		.sort(nameSorter);
	for (const func of functions) {
		renderFunction(func, level + 1, context);
	}

	const constants = exports
		.filter(ex => ex.kindString === 'Object literal')
		.sort(nameSorter);
	for (const constant of constants) {
		renderLiteral(constant, level + 1, context);
	}
}

/**
 * Render a class
 */
function renderClass(
	cls: DeclarationReflection,
	level: number,
	context: RenderContext
) {
	const { renderHeading, slugIndex, page } = context;
	const heading = renderHeading(level, cls, context);
	slugIndex[cls.id] = heading.id;

	if (cls.extendedTypes) {
		renderParent(cls.extendedTypes, Relationship.Extends, context);
	}

	if (isGenericReflection(cls)) {
		const typeParams = cls.typeParameter
			.map(param => typeParameterToString(param))
			.join(', ');
		const declaration = `${cls.name}<${typeParams}>`;
		const html = hljs.highlight('typescript', declaration, true).value;
		context.page.element.appendChild(
			h('p', {}, h('code.hljs.lang-typescript', { innerHTML: html }))
		);
	}

	if (hasComment(cls)) {
		page.element.appendChild(
			renderComment(cls.comment, getContainingModule(cls), context)
		);
	}

	const exports = getExports(cls);

	const properties = exports
		.filter(
			ex => ex.kindString === 'Property' || ex.kindString === 'Accessor'
		)
		.sort(nameSorter);
	for (const property of properties) {
		renderProperty(property, level + 1, context);
	}

	const constructors = exports.filter(ex => ex.kindString === 'Constructor');
	for (const ctor of constructors) {
		renderMethod(ctor, level + 1, context);
	}

	const methods = exports
		.filter(ex => ex.kindString === 'Method')
		.sort(nameSorter);
	for (const method of methods) {
		renderMethod(method, level + 1, context);
	}
}

/**
 * Indicate whetehr a reflection is a GenericReflection
 */
function isGenericReflection(type: Reflection): type is GenericReflection {
	return (<any>type).typeParameter != null;
}

/**
 * Indicate whetehr a reflection is a ContainerReflection
 */
function isContainerReflection(type: Reflection): type is ContainerReflection {
	return (<any>type).children != null;
}

/**
 * Render a type parameter
 */
function typeParameterToString(param: TypeParameterReflection) {
	if (param.type) {
		return `${param.name} extends ${typeToString(param.type)}`;
	} else {
		return param.name;
	}
}

/**
 * Render a class method
 */
function renderMethod(
	method: DeclarationReflection,
	level: number,
	context: RenderContext
) {
	renderFunction(method, level, context);
}

/**
 * Render a class or interface inheritance chain
 */
function renderParent(
	types: Type[],
	relationship: Relationship,
	context: RenderContext
) {
	for (const type of types) {
		const p = h('p.api-metadata', {}, [
			h('span.api-label', {}, `${relationship}: `)
		]);
		p.appendChild(renderType(type, context));
		context.page.element.appendChild(p);
	}
}

/**
 * Render a TypeScript interface
 */
function renderInterface(
	iface: DeclarationReflection,
	level: number,
	context: RenderContext
) {
	const { renderHeading, slugIndex, page } = context;
	const heading = renderHeading(level, iface, context);
	slugIndex[iface.id] = heading.id;

	if (iface.extendedTypes) {
		renderParent(iface.extendedTypes, Relationship.Extends, context);
	}

	if (hasComment(iface)) {
		page.element.appendChild(
			renderComment(iface.comment, getContainingModule(iface), context)
		);
	}

	if (iface.indexSignature) {
		renderHeading(level + 1, 'Index signature', context);
		// TypeDoc's typing is wrong -- this is always an array
		const sig: SignatureReflection[] = <any>iface.indexSignature;
		renderSignatures(sig, iface, context);
	}

	if (iface.signatures) {
		renderHeading(level + 1, 'Call signatures', context);
		renderSignatures(iface.signatures, iface, context);
	}

	const exports = getExports(iface);

	const properties = exports
		.filter(ex => ex.kindString === 'Property')
		.sort(nameSorter);
	for (const property of properties) {
		renderProperty(property, level + 1, context);
	}

	const constructors = exports.filter(ex => ex.kindString === 'Constructor');
	for (const ctor of constructors) {
		renderMethod(ctor, level + 1, context);
	}

	const methods = exports
		.filter(ex => ex.kindString === 'Method')
		.sort(nameSorter);
	for (const method of methods) {
		renderMethod(method, level + 1, context);
	}
}

/**
 * Render a class or interface property
 */
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

	let typeString: string | undefined;
	let access = { canRead: false, canWrite: false };
	let comment: Comment | undefined;

	if (property.kindString === 'Accessor') {
		if (property.getSignature) {
			access.canRead = true;
			const sig = (<any>property.getSignature)[0];
			typeString = typeToString(sig.type);
			if (hasComment(sig)) {
				comment = sig.comment;
			}
		}
		if (property.setSignature) {
			access.canWrite = true;
			const sig = (<any>property.setSignature)[0];
			if (!typeString) {
				typeString = typeToString(sig.parameters[0].type);
			}
			if (!comment && hasComment(sig)) {
				comment = sig.comment;
			}
		}
	} else {
		access.canRead = true;
		access.canWrite = true;
		comment = property.comment;
		typeString = typeToString(property.type);
	}

	const text = `${property.name}: ${typeString}`;
	const codeP = renderCode(text);
	if (!access.canRead) {
		const code = codeP.childNodes[0];
		const tag = h('span.tag', {}, 'write only');
		code.insertBefore(tag, code.firstChild);
	} else if (!access.canWrite) {
		const code = codeP.childNodes[0];
		const tag = h('span.tag', {}, 'read only');
		code.insertBefore(tag, code.firstChild);
	}

	page.element.appendChild(codeP);

	if (comment) {
		page.element.appendChild(
			renderComment(comment, getContainingModule(property), context)
		);
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
	const { renderHeading, slugIndex, page } = context;
	const heading = renderHeading(level, func, context);
	slugIndex[func.id] = heading.id;

	renderSignatures(func.signatures!, func, context);

	for (const signature of func.signatures!) {
		if (hasComment(signature)) {
			page.element.appendChild(
				renderComment(
					signature.comment,
					getContainingModule(func),
					context
				)
			);
			break;
		}
	}
}

/**
 * Render an array of function/method signatures
 */
function renderSignatures(
	signatures: SignatureReflection[],
	parent: ContainerReflection,
	context: RenderContext
) {
	const { page } = context;
	for (const sig of signatures) {
		const html = hljs.highlight('typescript', signatureToString(sig), true)
			.value;
		page.element.appendChild(
			h('p', {}, [h('code.hljs.lang-typescript', { innerHTML: html })])
		);
	}

	const parameters = signatures.reduce(
		(params, sig) => {
			return params.concat(sig.parameters || []);
		},
		<ParameterReflection[]>[]
	);
	if (parameters.length > 0) {
		renderParameterTable(parameters, parent, context);
	}
}

/**
 * Render a table of signature parameters
 */
function renderParameterTable(
	parameters: ParameterReflection[],
	parent: ContainerReflection,
	context: RenderContext
) {
	const { page } = context;
	const params = parameters.filter(param => {
		return hasComment(param) || param.defaultValue;
	});

	if (params.length > 0) {
		const rows = params.map(param => {
			let comment: Element | undefined;
			if (hasComment(param)) {
				comment = renderComment(
					param.comment,
					getContainingModule(parent),
					context
				);
			}
			return [param.name, comment || '', param.defaultValue || ''];
		});

		page.element.appendChild(
			h('p', {}, [
				createTable(['Parameter', 'Description', 'Default'], rows)
			])
		);
	}
}

/**
 * Render a literal value
 */
function renderLiteral(
	value: DeclarationReflection,
	level: number,
	context: RenderContext
) {
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
		const text = `${value.name}: ${type} = {\n\t${parts.join(',\n\t')}\n}`;
		page.element.appendChild(renderCode(text));
	}
}

/**
 * Render a declaration comment
 */
function renderComment(
	comment: Comment,
	module: ContainerReflection,
	context: RenderContext
) {
	const { page, linksToResolve } = context;
	const element = h('p', { innerHTML: commentToHtml(comment, page.name) });

	const links = <NodeListOf<HTMLAnchorElement>>element.querySelectorAll('a');
	for (let i = 0; i < links.length; i++) {
		if (links[i].href.indexOf('api:') === 0) {
			const link = links[i];
			const name = link.href.slice('api:'.length);
			const id = getReflectionIdForName(name, context, module);
			linksToResolve.push({ link, id });
		}
	}

	return element;
}

/**
 * Generate HTML for an API comment
 */
function commentToHtml(comment: Comment, pageName: string) {
	let parts: string[] = [];

	if (comment.shortText) {
		parts.push(renderText(comment.shortText, pageName));
	}

	if (comment.text) {
		parts.push(renderText(comment.text, pageName));
	}

	return parts.join('');
}

/**
 * Render comment text
 */
function renderText(text: string, pageName: string) {
	// Fix jsdoc-style links
	text = text.replace(/\[\[(.*?)(?:\|(.*?))?]]/g, (_match, p1, p2) => {
		let name = p2 || p1;
		// If the target name is dotted or slashed (e.g., Executor.Config) and
		// the user didn't provide a name, use the last element in the list as
		// the link text
		if (!p2 && (p1.indexOf('.') !== -1 || p1.indexOf('/') !== -1)) {
			const lastDot = p1.lastIndexOf('.');
			const lastSlash = p1.lastIndexOf('/');
			name = p1.slice(Math.max(lastDot, lastSlash) + 1);
		}
		return `[${name}](api:${p1})`;
	});
	return renderMarkdown(text, {
		info: { page: pageName, type: DocType.api }
	});
}

/**
 * Render a syntax-highlighted block of code
 */
function renderCode(text: string, language = 'typescript') {
	const html = hljs
		.highlight(language, text, true)
		.value.replace(/\n/g, '<br>')
		.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
	return h('p', {}, [h(`code.hljs.lang-${language}`, { innerHTML: html })]);
}

/**
 * Render a link to an element's source code
 */
function createSourceLink(source: SourceReference, context: RenderContext) {
	// Don't try to create links for files with absolute paths
	if (source.fileName[0] === '/') {
		return;
	}

	const link = <HTMLElement>createGitHubLink(
		{
			project: context.docSetId.project,
			version: context.docSetId.version!
		},
		`src/${source.fileName}#L${source.line}`
	);
	link.title = `${source.fileName}#L${source.line}`;
	return <HTMLAnchorElement>link;
}

/**
 * Generate a string representation of a function/method signature
 */
function signatureToString(
	signature: SignatureReflection,
	isParameter = false
): string {
	if (signature.name === '__index') {
		const param = signature.parameters[0];
		return `[${param.name}: ${typeToString(param.type)}]: ${typeToString(
			signature.type
		)}`;
	} else {
		let name = signature.name;
		if (name === '__call') {
			name = '';
		}

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
}

/**
 * Generate a string representation of a type
 */
function typeToString(type: Type): string {
	if (isStringLiteralType(type)) {
		return `'${type.value}'`;
	} else if (isUnionType(type)) {
		const strings = type.types!.map(typeToString);
		return strings.join(' | ');
	} else if (isArrayType(type)) {
		return `${typeToString(type.elementType!)}[]`;
	} else if (isReflectionType(type)) {
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
			} else if (d.name === '__type') {
				return '{ ... }';
			}
		}
	} else if (isReferenceType(type)) {
		let str = type.name!;
		if (type.typeArguments) {
			const args = type.typeArguments.map((arg: any) => {
				return typeToString(arg);
			});
			str += `<${args.join(', ')}>`;
		}
		return str;
	} else if (isIntrinsicType(type)) {
		return type.name;
	} else if (isTypeParameterType(type)) {
		if (type.constraint) {
			return `${type.name}<${typeToString(type.constraint)}>`;
		} else {
			return type.name;
		}
	} else if (isUnknownType(type)) {
		return type.name;
	}

	return type.type;
}

/**
 * Indicate whether a value is a string literal
 */
function isStringLiteralType(type: Type): type is StringLiteralType {
	return type.type === 'stringLiteral';
}

/**
 * Indicate whether a value is a union
 */
function isUnionType(type: Type): type is UnionType {
	return type.type === 'union';
}

/**
 * Indicate whether a value is an array
 */
function isArrayType(type: Type): type is ArrayType {
	return type.type === 'array';
}

/**
 * Indicate whether a value is a reflection
 */
function isReflectionType(type: Type): type is ReflectionType {
	return type.type === 'reflection';
}

/**
 * Indicate whether a value is a reference type
 */
function isReferenceType(type: Type): type is ReferenceType {
	return type.type === 'reference';
}

/**
 * Indicate whether a value is an intrinsic type
 */
function isIntrinsicType(type: Type): type is IntrinsicType {
	return type.type === 'intrinsic';
}

/**
 * Indicate whether a value is a type parameter
 */
function isTypeParameterType(type: Type): type is TypeParameterType {
	return type.type === 'typeParameter';
}

function isUnknownType(type: Type): type is UnknownType {
	return type.type === 'unknown';
}

// Render a type to a DOM node
function renderType(type: any, context: RenderContext): HTMLElement {
	if (type.type === 'stringLiteral') {
		return h('span.type-literal', {}, type.value);
	} else if (type.type === 'union') {
		return h('span.type-union', {}, type.types!.map(renderType));
	} else if (type.type === 'array') {
		const node = renderType(type.elementType!, context);
		node.classList.add('type-array');
		return node;
	} else if (type.type === 'reflection') {
		const d = type.declaration!;
		if (d.kindString === 'Type literal') {
			if (d.children) {
				const parts = d.children.map((child: any) => {
					const typeNode = renderType(child.type, context);
					return h('span', {}, [
						h('span.type-label', {}, child.name),
						typeNode
					]);
				});

				return h('span.type-list', {}, parts);
			} else if (d.signatures) {
				return h('span.type-signature', {
					innerHTML: signatureToString(d.signatures[0], true)
				});
			}
		}
	}

	const returnType = h('span');
	if (type.type === 'reference' && type.id != null) {
		const link = h('a', {}, type.name);
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
		returnType.appendChild(h('span.type-list.type-arg', {}, args));
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
		const classes: string[] = [];

		let type: string | undefined;
		if (typeof content !== 'string') {
			type = content.kindString;
		} else if (content === 'Call signatures') {
			type = 'Function';
		}

		if (type) {
			classes.push('is-type');
		}

		if (type === 'Method' || type === 'Function') {
			classes.push('is-type-callable');
		} else if (type === 'Property' || type === 'Accessor') {
			classes.push('is-type-property');
		} else if (type === 'Constructor') {
			classes.push('is-type-constructor');
		} else if (type === 'Class') {
			classes.push('is-type-class');
		} else if (type === 'Interface') {
			classes.push('is-type-interface');
		} else if (type === 'Object literal') {
			classes.push('is-type-constant');
		}

		const text =
			typeof content === 'string'
				? content
				: // Module names are surrounded by '"'
					content.name.replace(/^"|"$/g, '');
		const className = classes.join(' ');
		const heading = <HTMLElement>h(
			`h${level}`,
			{ className, id: slugify(text) },
			text
		);

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
function createTable(headings: string[], rows: (string | Element)[][]) {
	return h('table.table.is-bordered', {}, [
		h('thead', {}, [
			h('tr', {}, [headings.map(heading => h('th', {}, heading))])
		]),
		h(
			'tbody',
			{},
			rows.map(row =>
				h(
					'tr',
					{},
					row.map(content => {
						if (typeof content === 'string') {
							return h('td', { innerHTML: content });
						} else {
							return h('td', {}, content);
						}
					})
				)
			)
		)
	]);
}

/**
 * Indicate whether a reflection has a comment element wiht content
 */
function hasComment(reflection: Reflection) {
	const comment = reflection.comment;
	return comment && (comment.text || comment.shortText);
}

/**
 * Create an index of TypeDoc declaration IDs to data structures. This function
 * also creates parent relationships.
 */
function createApiIndex(data: ProjectReflection) {
	const index: ApiIndex = {};
	for (const child of data.children) {
		child.parent = data;
		walkTree(child);
	}
	return index;

	function walkTree(data: DeclarationReflection) {
		index[data.id] = data;
		if (data.children) {
			for (const child of data.children) {
				child.parent = data;
				walkTree(child);
			}
		}
	}
}

/**
 * Sorter function for sorting API reflections
 */
function nameSorter(a: Reflection, b: Reflection) {
	if (a.name < b.name) {
		return -1;
	}
	if (a.name > b.name) {
		return 1;
	}
	return 0;
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

interface NameRefs {
	[key: string]: number;
}

interface RenderContext {
	page: DocPage;
	renderHeading: HeadingRenderer;
	apiIndex: ApiIndex;
	slugIndex: SlugIndex;
	api: ProjectReflection;
	docSetId: DocSetId;
	linksToResolve: { link: HTMLAnchorElement; id: number }[];
	nameRefs: NameRefs;
}

enum Relationship {
	Extends = 'Extends',
	Inherited = 'Inherited from'
}
