/*hexo.extend.processor.register('docs/*.md', function(file){
    console.log(file);
});*/
var MarkdownIt = require('markdown-it'),
md = new MarkdownIt();

hexo.extend.filter.register('before_post_render', function(data){
    
  if(data.path.includes("docs/")) {
      if(data.source.includes(".md")) {
        data.layout = 'false'; 
       data.content = md.render(data._content);
      }
  }
  return data;
});