hexo.extend.filter.register('before_post_render', function(data){    
  if(data.path.includes("docs/") || data.path.includes("tutorials/")) {
      if(data.source.includes(".md")) {
        data.layout = 'docs';
      }
  }
  return data;
});