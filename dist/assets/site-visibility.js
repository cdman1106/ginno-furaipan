(()=>{
  const WORKER="https://instagram-web-auto-sync.cdman1106.workers.dev";
  const DEFAULT_PUBLIC=(document.currentScript?.dataset?.default||"private")==="public";

  function robots(value){
    let meta=document.querySelector('meta[name="robots"]');
    if(!meta){
      meta=document.createElement("meta");
      meta.name="robots";
      document.head.appendChild(meta);
    }
    meta.content=value;
  }

  function reveal(){
    const boot=document.getElementById("site-visibility-boot");
    if(boot) boot.remove();
    document.documentElement.style.visibility="visible";
  }

  function maintenance(){
    robots("noindex,nofollow,noarchive");
    document.title="洋食や 銀のフライパン｜非公開中";
    const render=()=>{
      document.body.innerHTML=`
        <main style="min-height:100vh;display:grid;place-items:center;padding:28px;background:#f5f1e8;color:#2b2823;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">
          <section style="width:min(620px,100%);text-align:center;padding:56px 28px;border:1px solid rgba(43,40,35,.18);background:rgba(255,255,255,.68);box-shadow:0 18px 60px rgba(43,40,35,.08)">
            <p style="font-family:Georgia,'Times New Roman',serif;letter-spacing:.28em;font-size:12px;margin:0 0 18px;color:#88775b">GIN NO FURAIPAN</p>
            <h1 style="font-family:'Yu Mincho','Hiragino Mincho ProN',serif;font-size:clamp(30px,7vw,48px);font-weight:500;letter-spacing:.08em;margin:0 0 24px">非公開中</h1>
            <div style="width:42px;height:1px;background:#a68b61;margin:0 auto 24px"></div>
            <p style="font-size:15px;line-height:2;margin:0;color:#5d574d">ただいまホームページを一時的に非公開にしております。</p>
            <small style="display:block;margin-top:34px;color:#9a9287;letter-spacing:.08em">洋食や 銀のフライパン</small>
          </section>
        </main>`;
      reveal();
    };
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",render,{once:true});
    else render();
  }

  async function check(){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),4500);
      const res=await fetch(WORKER+"/api/site-visibility?origin="+encodeURIComponent(location.origin),{
        method:"GET",
        mode:"cors",
        cache:"no-store",
        signal:controller.signal
      });
      clearTimeout(timer);
      if(!res.ok) throw new Error("visibility request failed");
      const state=await res.json();
      const isPublic=state.configured ? !!state.public : DEFAULT_PUBLIC;
      if(isPublic){
        robots("index,follow,max-image-preview:large");
        reveal();
      }else{
        maintenance();
      }
    }catch(_err){
      if(DEFAULT_PUBLIC){
        robots("index,follow,max-image-preview:large");
        reveal();
      }else{
        maintenance();
      }
    }
  }
  check();
})();