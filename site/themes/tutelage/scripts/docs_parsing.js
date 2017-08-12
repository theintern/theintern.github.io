hexo.extend.filter.register('before_post_render', function(data){    
  if(data.path.includes("docs/")) {
      if(data.source.includes(".md")) {
        data.layout = 'docs';
        //console.log(data.path);
        let ver = data.path.match(/v[0-9]/);
        data.version = ver;
      }
  }
  return data;
});