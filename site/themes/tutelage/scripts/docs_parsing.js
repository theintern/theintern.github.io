hexo.extend.filter.register('before_post_render', function(data){    
  if(data.path.includes("docs/")) {
      if(data.source.includes(".md")) {
        data.layout = 'fragment'; 
      }
  }
  return data;
});