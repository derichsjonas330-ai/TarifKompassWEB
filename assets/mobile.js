(function(){
  var dock = document.querySelector('.mobile-dock');
  var card = document.querySelector('.konf');
  if(!dock || !card || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(function(entries){
    dock.classList.toggle('is-hidden', entries[0].isIntersecting);
  },{rootMargin:'-100px 0px -90px 0px'}).observe(card);
})();
