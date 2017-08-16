const Metalsmith = require('metalsmith');
const layouts = require('metalsmith-layouts');
const sass = require('metalsmith-sass');
const assets = require('metalsmith-assets');
const browserSync = require('metalsmith-browser-sync');
const inlineSource = require('metalsmith-inline-source');
const ts = require('typescript');
const uglifyJs = require('uglify-js');

let serve = false;
let production = false;

process.argv.slice(2).forEach(arg => {
	switch (arg) {
	case 'serve':
		serve = true;
		break;
	case 'production':
		console.log('Building for production');
		production = true;
		break;
	}
});

const metalsmith = new Metalsmith(__dirname)
	.metadata({
		site: {
			name: 'The Intern',
			description: 'Software testing for humans'
		},
		pageType: 'default',
		bodyClass: '',
		production
	})
	.source('./src')
	.destination('./public')
	.use(docsets())
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
			outputStyle: production ? 'compressed' : 'expanded',
			sourceMap: !production,
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

if (production) {
	metalsmith.use(uglify())
}

if (serve) {
	metalsmith.use(
		browserSync({
			server: './public',
			files: ['./src/**/*', './resources/**/*'],
			open: false,
			notify: false
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
	return (files, metalsmith, done) => {
		const compilerOptions = {
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
			inlineSourceMap: true,
			inlineSources: true,
			outDir: './public',
			types: [
				'highlight.js',
				'markdown-it'
			]
		};

		if (metalsmith.metadata().production) {
			compilerOptions.inlineSourceMap = false;
		}

		const source = files['doc_viewer.ts'].contents.toString('utf8');
		let result = ts.transpileModule(source, { compilerOptions, fileName: 'doc_viewer.ts' });
		delete files['doc_viewer.ts'];
		files['doc_viewer.js'] = { contents: Buffer.from(result.outputText) };
		done();
	};
}

function docsets() {
	return (files, metalsmith, done) => {
		const data = files['docs.json'].contents.toString('utf8');
		metalsmith.metadata().docsets = JSON.parse(data);
		delete files['docs.json'];
		done();
	};
}

function uglify() {
	return (files, metalsmith, done) => {
		const jsFiles = Object.keys(files).filter(name => /\.js$/.test(name));
		jsFiles.forEach(name => {
			const data = files[name].contents.toString('utf8');
			const newData = uglifyJs.minify(data);
			files[name].contents = Buffer.from(newData.code);
		});
		done();
	};
}
