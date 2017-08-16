const Metalsmith = require('metalsmith');
const layouts = require('metalsmith-layouts');
const sass = require('metalsmith-sass');
const assets = require('metalsmith-assets');
const browserSync = require('metalsmith-browser-sync');
const inlineSource = require('metalsmith-inline-source');
const ts = require('typescript');

const metalsmith = new Metalsmith(__dirname)
	.metadata({
		site: {
			name: 'The Intern',
			description: 'Software testing for humans'
		},
		pageType: 'default',
		bodyClass: ''
	})
	.source('./src')
	.destination('./public')
	.ignore('**/*.ejs')
	.ignore('**/*.ts')
	.ignore('assets/*')
	.use(buildTypescript())
	.use(
		layouts({
			engine: 'ejs',
			directory: './src/layouts',
			default: 'default.ejs',
			pattern: '**/*.html'
		})
	)
	.use(
		sass({
			outputStyle: 'compressed',
			sourceMap: true,
			sourceMapContents: true,
			outputDir: 'css'
		})
	)
	.use(
		inlineSource({
			rootpath: './src/assets'
		})
	)
	.use(
		assets({
			source: './src/assets'
		})
	);

if (process.argv[2] === 'serve') {
	metalsmith.use(
		browserSync({
			server: './public',
			files: ['./src/**/*', './resources/**/*'],
			open: false
		})
	);
}

metalsmith.build(function(error) {
	if (error) {
		console.log(error);
	} else {
		console.log('Built!');
	}
});

function buildTypescript() {
	return (_files, _metalsmith, done) => {
		const options = {
			target: 1, // es5
			module: 0, // none
			lib: [
				'lib.dom.d.ts',
				'lib.es5.d.ts',
				'lib.es2015.iterable.d.ts',
				'lib.es2015.promise.d.ts'
			],
			strict: true,
			noUnusedLocals: true,
			noUnusedParameters: true,
			noImplicitReturns: true,
			noFallthroughCasesInSwitch: true,
			inlineSourceMap: false,
			inlineSources: false,
			sourceMap: true,
			outDir: './public',
			types: [
				'highlight.js',
				'markdown-it'
			]
		};

		let program = ts.createProgram(['./src/doc_viewer.ts'], options);
		let emitResult = program.emit();

		let allDiagnostics = ts
			.getPreEmitDiagnostics(program)
			.concat(emitResult.diagnostics);

		allDiagnostics.forEach(diagnostic => {
			let {
				line,
				character
			} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
			let message = ts.flattenDiagnosticMessageText(
				diagnostic.messageText,
				'\n'
			);
			console.log(
				`${diagnostic.file.fileName} (${line + 1},${character +
					1}): ${message}`
			);
		});

		let exitCode = emitResult.emitSkipped ? 1 : 0;
		if (exitCode !== 0) {
			done(new Error('Typescript build failed'));
		} else {
			done();
		}
	};
}
