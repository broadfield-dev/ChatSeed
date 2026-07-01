// ===== ChatSeed Files Module v2.1 - Safe Code Display =====
// This module handles:
//   RightSidebar (ScratchPad), FileManager, LineEditor,
//   Source capture, evolve_self line actions, undo system
//
// v2.1: All read_file/read/read_lines results wrap large content
// in dual-format JSON: {"model":"...full...","ui":"...truncated..."}
// The chat renderer will show the UI version while the model gets the full.

(function(){
var RIGHT_SIDEBAR_KEY="chatseed_scratchpad";

// ===== CORE STATE =====
var _rs={_visible:false,_files:[],_order:[],_active:null,_expandedContent:{},
_editTarget:null,_editBuffer:null,_pendingAction:null,
_undoStack:[],_batchBase:null,_fileManager:null,
_selectedFile:null,_fileStates:{},_currentTab:null,
_lastReadResult:null,_lastScratchLoaded:false,

// ===== UTILITY =====
_uid:function(){
  return "f_"+Date.now()+"_"+Math.random().toString(36).substr(2,6);
},

_getChatId:function(){
  if(typeof currentChatId!=="undefined"&&currentChatId)return currentChatId;
  return "global";
},

_getFilesForChat:function(chatId){
  return this._files.filter(function(f){return f.chatId===chatId||!f.chatId;});
},

_getFileCountForChat:function(chatId){
  return this._getFilesForChat(chatId).length;
},

_save:function(){
  try{
    var data={};
    for(var i=0;i<this._files.length;i++){
      var f=this._files[i];
      var key=f.chatId||"global";
      if(!data[key])data[key]=[];
      data[key].push({id:f.id,filename:f.filename,content:f.content,mime:f.mime,addedAt:f.addedAt});
    }
    localStorage.setItem(RIGHT_SIDEBAR_KEY,JSON.stringify(data));
  }catch(ex){console.error("RS save error:",ex);}
},

_load:function(){
  try{
    var raw=localStorage.getItem(RIGHT_SIDEBAR_KEY);
    if(!raw)return;
    var data=JSON.parse(raw);
    this._files=[];
    for(var chatId in data){
      var arr=data[chatId];
      for(var i=0;i<arr.length;i++){
        var f=arr[i];
        f.chatId=chatId;
        this._files.push(f);
      }
    }
  }catch(ex){console.error("RS load error:",ex);}
},

// ===== RENDER =====
render:function(){
  var tb=document.getElementById("rsTabBar"),pv=document.getElementById("rsPreview"),em=document.getElementById("rsEmpty");
  if(!tb||!pv||!em)return;
  var files=this._getFilesForChat(this._getChatId());
  if(files.length===0){
    tb.innerHTML="";pv.innerHTML="";em.style.display="flex";this._active=null;
    var tc=document.getElementById("rsToggleCount");
    if(tc)tc.textContent="0";
    return;
  }
  em.style.display="none";
  var html='<button class="rs-down-all" onclick="RightSidebar.downloadAll()" title="Download all files"><i class="fas fa-download"></i></button>';
  for(var i=0;i<files.length;i++){
    var f=files[i];
    var active=f.id===this._active;
    var isText=this._isTextFile(f.filename);
    var icon=isText?'<i class="fas fa-file-code"></i>':'<i class="fas fa-file"></i>';
    var ext=f.filename.split('.').pop()||"?";
    html+='<div class="rs-tab'+(active?' rs-tab-active':'')+'" onclick="RightSidebar.selectFile(\''+f.id+'\')"><span class="rs-ext">'+ext+'</span><span class="rs-fname">'+this._escapeHTML(f.filename)+'</span><div class="rs-tab-actions"><span class="rs-btn-download" onclick="event.stopPropagation();RightSidebar.downloadFile(\''+f.id+'\')" title="Download"><i class="fas fa-download"></i></span><span class="rs-btn-close" onclick="event.stopPropagation();RightSidebar.removeFile(\''+f.id+'\')" title="Remove"><i class="fas fa-times"></i></span></div></div>';
  }
  tb.innerHTML=html;
  var tc=document.getElementById("rsToggleCount");
  if(tc)tc.textContent=files.length;
  if(this._active){
    var af=null;
    for(var i=0;i<files.length;i++){if(files[i].id===this._active){af=files[i];break;}}
    if(af)this._renderPreview(af);
    else{if(files.length>0){this._active=files[0].id;this._renderPreview(files[0]);}}
  } else {
    if(files.length>0){this._active=files[0].id;this._renderPreview(files[0]);}
    else pv.innerHTML="";
  }
},

_renderPreview:function(file){
  var pv=document.getElementById("rsPreview");if(!pv)return;
  if(!file){pv.innerHTML='<div class="rs-empty-inner">No file selected</div>';return;}
  var isText=this._isTextFile(file.filename);
  var content=file.content||"";
  if(!isText){
    pv.innerHTML='<div class="rs-file-info"><div class="rs-file-icon"><i class="fas fa-file"></i></div><div class="rs-file-meta"><span class="rs-file-name">'+this._escapeHTML(file.filename)+'</span><span class="rs-file-size">'+this._formatSize(content.length)+'</span><button class="rs-download-btn" onclick="RightSidebar.downloadFile(\''+file.id+'\')"><i class="fas fa-download"></i> Download</button></div></div>';
    return;
  }
  var truncated=content.length>30000;
  var displayContent=truncated?content.substring(0,30000)+"\n\n// ... truncated at 30000 chars for preview":content;
  pv.innerHTML='<div class="rs-file-header"><span class="rs-file-name">'+this._escapeHTML(file.filename)+'</span><span class="rs-file-size">'+this._formatSize(content.length)+'</span></div><div class="rs-code-wrap"><pre class="rs-code"><code>'+this._escapeHTML(displayContent)+'</code></pre></div><div class="rs-actions"><button class="rs-action-btn" onclick="RightSidebar.downloadFile(\''+file.id+'\')"><i class="fas fa-download"></i> Download</button></div>';
},

selectFile:function(id){
  this._active=id;this.render();
},

toggle:function(){
  var el=document.getElementById("rightSidebar");
  if(!el)return;
  if(this._visible){this.hide();}else{this.show();}
},

show:function(){
  var el=document.getElementById("rightSidebar");
  var backdrop=document.getElementById("rsBackdrop");
  if(!el)return;
  this._visible=true;
  el.classList.remove("collapsed");
  el.classList.add("open");
  if(backdrop&&isTablet())backdrop.classList.add("show");
  var t=document.getElementById("rightSidebarToggle");
  if(t)t.classList.add("open");
  this.render();
},

hide:function(){
  var el=document.getElementById("rightSidebar");
  var backdrop=document.getElementById("rsBackdrop");
  if(!el)return;
  this._visible=false;
  el.classList.remove("open");
  el.classList.add("collapsed");
  if(backdrop)backdrop.classList.remove("show");
  var t=document.getElementById("rightSidebarToggle");
  if(t)t.classList.remove("open");
},

loadForChat:function(chatId){
  this._order=[];
  this._active=null;
  var files=this._getFilesForChat(chatId);
  if(files.length>0){this._active=files[0].id;}
  this.render();
},

// ===== FILE OPERATIONS =====
addFile:function(filename,content,mime){
  content=content||"";
  var file={id:this._uid(),filename:filename,content:content,mime:mime||"text/plain",chatId:this._getChatId(),addedAt:Date.now()};
  this._files.push(file);
  this._order.push(file.id);
  this._active=file.id;
  this._save();
  this.render();
  return file;
},

addOrUpdateFile:function(filename,content,mime){
  content=content||"";
  var chatId=this._getChatId();
  if(filename===this._editTarget){
    if(this._editBuffer){
      content=this._editBuffer;
      this._editBuffer=null;
    }
  }
  for(var i=0;i<this._files.length;i++){
    if(this._files[i].filename===filename&&this._files[i].chatId===chatId){
      this._files[i].content=content;
      this._files[i].mime=mime||"text/plain";
      this._files[i].addedAt=Date.now();
      this._active=this._files[i].id;
      this._save();
      this.render();
      return this._files[i];
    }
  }
  return this.addFile(filename,content,mime);
},

removeFile:function(id){
  for(var i=0;i<this._files.length;i++){
    if(this._files[i].id===id){
      this._files.splice(i,1);break;
    }
  }
  var oIdx=this._order.indexOf(id);
  if(oIdx>-1)this._order.splice(oIdx,1);
  if(this._active===id){
    var files=this._getFilesForChat(this._getChatId());
    this._active=files.length>0?files[0].id:null;
  }
  this._save();
  this.render();
},

clearAll:function(){
  if(this._files.length===0)return;
  if(typeof showConfirmDialog==="function"){
    showConfirmDialog("Remove all files from scratchpad?",function(confirmed){
      if(!confirmed)return;
      var chatId=typeof currentChatId!=="undefined"?currentChatId:null;
      RightSidebar._files=RightSidebar._files.filter(function(f){return f.chatId!==chatId&&chatId;});
      if(chatId){RightSidebar._files=RightSidebar._files.filter(function(f){return f.chatId!==chatId;});}
      RightSidebar._order=[];RightSidebar._active=null;
      RightSidebar._save();RightSidebar.render();
      if(typeof showToast==="function")showToast("ScratchPad cleared");
    });
  } else {
    var chatId=typeof currentChatId!=="undefined"?currentChatId:null;
    if(chatId)this._files=this._files.filter(function(f){return f.chatId!==chatId;});
    else{this._files=[];}
    this._order=[];this._active=null;
    this._save();this._render();
  }
},

uploadFile:function(){
  var input=document.getElementById("fileInput");
  if(!input)return;
  input.onchange=function(e){
    var files=e.target.files;
    if(!files||!files.length)return;
    for(var i=0;i<files.length;i++){
      (function(file){
        var reader=new FileReader();
        reader.onload=function(ev){
          var content=ev.target.result;
          RightSidebar._files.push({
            id:RightSidebar._uid(),
            filename:file.name,
            mime:file.type||"text/plain",
            content:content,
            chatId:RightSidebar._getChatId(),
            addedAt:Date.now()
          });
          RightSidebar._active=RightSidebar._files[RightSidebar._files.length-1].id;
          RightSidebar._save();
          RightSidebar.render();
          if(typeof showToast==="function")showToast("Uploaded: "+file.name);
        };
        reader.readAsText(file);
      })(files[i]);
    }
  };
  input.click();
},

downloadFile:function(id){
  for(var i=0;i<this._files.length;i++){
    if(this._files[i].id===id){
      var f=this._files[i];
      var blob=new Blob([f.content],{type:f.mime||"text/plain"});
      var url=URL.createObjectURL(blob);
      var a=document.createElement("a");
      a.href=url;a.download=f.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){URL.revokeObjectURL(url);},5000);
      return;
    }
  }
},

downloadAll:function(){
  var files=this._getFilesForChat(this._getChatId());
  if(files.length===0){if(typeof showToast==="function")showToast("No files to download");return;}
  for(var i=0;i<files.length;i++){
    (function(f,delay){
      setTimeout(function(){
        var blob=new Blob([f.content],{type:f.mime||"text/plain"});
        var url=URL.createObjectURL(blob);
        var a=document.createElement("a");
        a.href=url;a.download=f.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){URL.revokeObjectURL(url);},5000);
      },delay);
    })(files[i],i*300);
  }
  if(typeof showToast==="function")showToast("Downloading "+files.length+" files");
},

// ===== VERSION FILES =====
saveFileVersion:function(filename,content,description){
  if(typeof DB!=="undefined"&&DB&&DB._ready){
    DB.saveFileVersion(filename,content,description);
  }
},

// ===== HELPERS =====
_isTextFile:function(filename){
  var ext=filename.split('.').pop().toLowerCase();
  var textExts=["txt","js","jsx","ts","tsx","html","css","scss","less","json","xml","yaml","yml","md","markdown","py","rb","java","c","cpp","h","hpp","cs","go","rs","php","swift","kt","scala","lua","sql","sh","bash","zsh","fish","ps1","bat","cfg","ini","conf","toml","env","gitignore","dockerfile","gradle","mjs","cjs","vue","svelte","astro","htm","xhtml","svg","csv","tsv","log","tex","bib","rst","adoc","asciidoc","r","m","pl","pm","t","raku","zig","nim","cr","clj","cljs","edn","ex","exs","erl","hrl","fs","fsx","fsi","dart","lisp","el","lsp","scm","ss","rkt","hs","lhs","erl","nix","dhall","json5","jsonc","properties","strings","srt","vtt","m3u","m3u8","plist","xcconfig","pbxproj","storyboard","xib","tf","tfvars","hcl","docker-compose","makefile","cmake","ninja","bazel","webmanifest","wasm","map"];
  return textExts.indexOf(ext)!==-1;
},

_formatSize:function(bytes){
  if(bytes<1024)return bytes+" B";
  if(bytes<1048576)return(bytes/1024).toFixed(1)+" KB";
  return(bytes/1048576).toFixed(1)+" MB";
},

_escapeHTML:function(str){
  if(!str)return"";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
},

// ===== LINE EDITOR =====
// Manages the ScratchPad files as editable buffers
// _editTarget = current active filename
// _editBuffer = content being edited
// _batchBase = stack for batched operations

initLineEditor:function(){
  this._editTarget=null;
  this._editBuffer=null;
  this._pendingAction=null;
  this._batchBase=[];
  this._undoStack=[];
  this._fileStates={};
  this._lastReadResult=null;
  this._lastScratchLoaded=false;
},

setTargetFile:function(filename){
  this._editTarget=filename;
  var files=this._files;
  var chatId=this._getChatId();
  for(var i=0;i<files.length;i++){
    if(files[i].filename===filename&&files[i].chatId===chatId){
      this._editBuffer=files[i].content;
      this._active=files[i].id;
      this.render();
      return {filename:filename,lines:this._editBuffer.split("\n").length,chars:this._editBuffer.length};
    }
  }
  // File not found in scratchpad
  this._editBuffer="";
  return {filename:filename,lines:0,chars:0,status:"new"};
},

getFileContent:function(filename){
  var files=this._files;
  var chatId=this._getChatId();
  for(var i=0;i<files.length;i++){
    if(files[i].filename===filename&&files[i].chatId===chatId){
      return files[i].content;
    }
  }
  return null;
},

setFileContent:function(filename,content){
  this.addOrUpdateFile(filename,content,"text/plain");
  if(this._editTarget===filename)this._editBuffer=content;
},

getActiveTarget:function(){
  return this._editTarget;
},

getActiveContent:function(){
  return this._editBuffer;
},

// ===== UNDO SYSTEM =====
pushUndo:function(filename,oldContent){
  this._undoStack.push({filename:filename,content:oldContent,timestamp:Date.now()});
  if(this._undoStack.length>50)this._undoStack.shift();
},

popUndo:function(){
  if(this._undoStack.length===0)return null;
  return this._undoStack.pop();
},

// ===== CAPTURE SOURCE =====
captureSource:function(){
  var sources={};
  try{
    sources.sourceHTML=document.documentElement.outerHTML;
  }catch(ex){sources.sourceHTML="[unavailable]";}
  try{
    var scripts=document.querySelectorAll("script:not([src])");
    var inlineScripts=[];
    for(var i=0;i<scripts.length;i++){
      if(scripts[i].textContent&&scripts[i].textContent.length>100){
        inlineScripts.push(scripts[i].textContent);
      }
    }
    sources.inlineScripts=inlineScripts;
  }catch(ex){sources.inlineScripts=[];}
  return sources;
},

// ===== DUAL-FORMAT WRAPPER =====
// Wraps content in {model, ui} JSON if it exceeds display thresholds
_wrapDualFormat:function(modelContent,uiContent){
  return JSON.stringify({model:modelContent,ui:uiContent});
},

// Truncate content for UI display
_truncateUI:function(content,maxChars,maxLines){
  maxChars=maxChars||3000;
  maxLines=maxLines||80;
  if(!content)return {text:content||"",truncated:false};
  var lines=content.split('\n');
  if(content.length<=maxChars&&lines.length<=maxLines){
    return {text:content,truncated:false};
  }
  // Truncate by chars
  var truncated=content.substring(0,maxChars);
  var lastNewline=truncated.lastIndexOf('\n');
  if(lastNewline>maxChars*0.7){
    truncated=truncated.substring(0,lastNewline);
  }
  return {text:truncated,truncated:true,extraChars:content.length-truncated.length};
},

// ===== LINE ACTION HANDLER =====
// Handles evolve_self tool calls for file operations
handleLineAction:function(args){
  if(!args||!args.action){
    return JSON.stringify({model:"Error: no action specified",ui:"Error: no action specified"});
  }
  
  var action=args.action;
  var description=args.description||"";
  
  // --- load_source ---
  if(action==="load_source"||action==="capture_source"){
    try{
      var fullHTML=document.documentElement.outerHTML;
      var lines=fullHTML.split('\n');
      var lineCount=lines.length;
      
      // Save to scratchpad
      this.addOrUpdateFile("chatseed.html",fullHTML,"text/html");
      this._editTarget="chatseed.html";
      this._editBuffer=fullHTML;
      
      var uiMsg="**📥 Source loaded:** `chatseed.html` — **"+lineCount+" lines** (loaded your currently running source code from browser memory into ScratchPad).\nNow editing `chatseed.html`. Use `list_files` to browse, `read_lines` to inspect, `edit_lines` to make changes.\n\n📂 **Editing:** `chatseed.html` (v1, "+lineCount+" lines)";
      
      var modelMsg="**📥 Source loaded:** `chatseed.html` — **"+lineCount+" lines** (loaded from browser memory).\n\n```html\n"+fullHTML.substring(0,5000)+(fullHTML.length>5000?"\n\n... ["+Math.round((fullHTML.length-5000)/60)+" more lines]":""+"\n```\n\n📂 **Editing:** `chatseed.html` (v1, "+lineCount+" lines)");
      
      return this._wrapDualFormat(modelMsg,uiMsg);
    }catch(ex){
      return this._wrapDualFormat("Error capturing source: "+ex.message,"Error capturing source: "+ex.message);
    }
}
  
  // --- read / read_file ---
  if(action==="read"||action==="read_file"){
    var filename=args.new_filename||args.target_filename||this._editTarget;
    if(!filename){
      return this._wrapDualFormat(
        "No file selected. Use `set_target_file` or specify `new_filename`.",
        "No file selected. Use `set_target_file` or specify `new_filename`."
      );
    }
    
    var content=this.getFileContent(filename);
    if(content===null){
      return this._wrapDualFormat(
        'File "'+filename+'" not found in ScratchPad.\nAvailable files: '+this._listFileNames(),
        'File "'+filename+'" not found in ScratchPad.\nAvailable files: '+this._listFileNames()
      );
    }
    
    var lines=content.split('\n');
    var totalLines=lines.length;
    var totalChars=content.length;
    
    // Build full model content
    var lang=this._detectLanguage(filename);
    var modelContent="**📄 `"+filename+"`** — **"+totalLines+" lines**\n\n```"+lang+"\n"+content+"\n```\n\n**Lines:** "+totalLines+" | **Chars:** "+totalChars;
    
    // Build UI content (truncated)
    var truncInfo=this._truncateUI(content,3000,80);
    var uiContent="**📄 `"+filename+"`** — **"+totalLines+" lines**";
    if(truncInfo.truncated){
      uiContent+=" (showing "+(truncInfo.text.split('\n').length)+" of "+totalLines+" lines)\n\n```"+lang+"\n"+truncInfo.text+"\n```\n\n*(Showing truncated view. Full content available to AI. Use `read_lines start=N end=M` for specific ranges.)*\n\n**Lines:** "+totalLines+" | **Chars:** "+totalChars;
    } else {
      uiContent+="\n\n```"+lang+"\n"+content+"\n```\n\n**Lines:** "+totalLines+" | **Chars:** "+totalChars;
    }
    
    return this._wrapDualFormat(modelContent,uiContent);
  }
  
  // --- read_lines ---
  if(action==="read_lines"){
    var filename=args.new_filename||args.target_filename||this._editTarget;
    if(!filename){
      return this._wrapDualFormat(
        "No file selected. Use `set_target_file` or specify `new_filename`.",
        "No file selected. Use `set_target_file` or specify `new_filename`."
      );
    }
    
    var content=this.getFileContent(filename);
    if(content===null){
      return this._wrapDualFormat(
        'File "'+filename+'" not found.',
        'File "'+filename+'" not found.'
      );
    }
    
    var lines=content.split('\n');
    var totalLines=lines.length;
    var start=Math.max(1,parseInt(args.start_line)||1);
    var end=Math.min(totalLines,parseInt(args.end_line)||Math.min(start+199,totalLines));
    if(start>end){var tmp=start;start=end;end=tmp;}
    
    var selected=lines.slice(start-1,end);
    var lang=this._detectLanguage(filename);
    
    // Build line-numbered content
    var numberedLines=[];
    for(var i=0;i<selected.length;i++){
      numberedLines.push((start+i)+" | "+selected[i]);
    }
    var lineContent=numberedLines.join('\n');
    
    var modelContent="Lines "+start+"-"+end+" of "+totalLines+" from `"+filename+"`\n\n```"+lang+"\n"+lineContent+"\n```";
    
    // For read_lines, always show all requested lines (it's already scoped)
    var uiContent=modelContent;
    
    return this._wrapDualFormat(modelContent,uiContent);
  }
  
  // --- set_target_file ---
  if(action==="set_target_file"){
    var tf=args.target_filename||args.new_filename;
    if(!tf){
      return this._wrapDualFormat(
        "Specify `target_filename`.",
        "Specify `target_filename`."
      );
    }
    var result=this.setTargetFile(tf);
    this._editTarget=tf;
    var msg="**🎯 Target set:** `"+tf+"`";
    if(result.lines>0)msg+=" ("+result.lines+" lines, "+result.chars+" chars)";
    else msg+=" (new file)";
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- write_file / write ---
  if(action==="write_file"||action==="write"){
    var fn=args.new_filename||args.target_filename;
    var newCode=args.new_code||args.content;
    if(!fn||!newCode){
      return this._wrapDualFormat(
        "Both `new_filename` and `new_code` (or `content`) are required.",
        "Both `new_filename` and `new_code` (or `content`) are required."
      );
    }
    
    // Save version of old file if it exists
    var oldContent=this.getFileContent(fn);
    if(oldContent!==null){
      this.saveFileVersion(fn,oldContent,"Version backup before write");
      this.pushUndo(fn,oldContent);
    }
    
    this.addOrUpdateFile(fn,newCode,"text/plain");
    this._editTarget=fn;
    this._editBuffer=newCode;
    
    var lines=newCode.split('\n').length;
    var msg="**📝 Written:** `"+fn+"` — **"+lines+" lines**";
    
    // Also save a versioned copy as .v1, .v2 etc.
    var baseName=fn;
    var ext="";
    var dotIdx=fn.lastIndexOf('.');
    if(dotIdx>0){baseName=fn.substring(0,dotIdx);ext=fn.substring(dotIdx);}
    
    // Check existing versions
    var versionNum=0;
    for(var i=0;i<this._files.length;i++){
      var f=this._files[i];
      var chatId=this._getChatId();
      if(f.chatId===chatId){
        var prefix=baseName+".v";
        if(f.filename.indexOf(prefix)===0){
          var num=parseInt(f.filename.substring(prefix.length))||0;
          if(num>versionNum)versionNum=num;
        }
      }
    }
    
    // Actually, let's just note it
    msg+=" (previous version preserved as auto-backup).\nNow editing `"+fn+"`.";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- edit_lines ---
  if(action==="edit_lines"){
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn){
      return this._wrapDualFormat(
        "No target file. Use `target_filename` or set via `set_target_file`.",
        "No target file. Use `target_filename` or set via `set_target_file`."
      );
    }
    
    var content=this.getFileContent(fn);
    if(content===null){
      return this._wrapDualFormat('File "'+fn+'" not found.','File "'+fn+'" not found.');
    }
    
    var lines=content.split('\n');
    this.pushUndo(fn,content);
    
    var ln=parseInt(args.line_number)||1;
    var newCode=args.new_code||args.content||"";
    
    if(ln>=1&&ln<=lines.length){
      lines[ln-1]=newCode;
    } else if(ln===lines.length+1){
      lines.push(newCode);
    } else {
      return this._wrapDualFormat("Line "+ln+" out of range (1-"+lines.length+").","Line "+ln+" out of range (1-"+lines.length+").");
    }
    
    var newContent=lines.join('\n');
    this.setFileContent(fn,newContent);
    this._editBuffer=newContent;
    this._editTarget=fn;
    
    var msg="**✏️ Edited line "+ln+"** in `"+fn+"` — **"+lines.length+" lines** total.\n📂 **Editing:** `"+fn+"` (v"+this._getVersionCount(fn)+", "+lines.length+" lines)";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- insert_lines ---
  if(action==="insert_lines"){
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn)return this._wrapDualFormat("No target file.","No target file.");
    
    var content=this.getFileContent(fn);
    if(content===null)return this._wrapDualFormat('File "'+fn+'" not found.','File "'+fn+'" not found.');
    
    var lines=content.split('\n');
    this.pushUndo(fn,content);
    
    var ln=Math.min(parseInt(args.line_number)||1,lines.length+1);
    var newCode=args.new_code||args.content||"";
    var newLines=newCode.split('\n');
    
    var before=lines.slice(0,ln-1);
    var after=lines.slice(ln-1);
    lines=before.concat(newLines).concat(after);
    
    var newContent=lines.join('\n');
    this.setFileContent(fn,newContent);
    this._editBuffer=newContent;
    this._editTarget=fn;
    
    var msg="**➕ Inserted "+newLines.length+" line(s) at line "+ln+"** in `"+fn+"` — **"+lines.length+" lines** total.\n📂 **Editing:** `"+fn+"` (v"+this._getVersionCount(fn)+", "+lines.length+" lines)";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- delete_lines ---
  if(action==="delete_lines"){
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn)return this._wrapDualFormat("No target file.","No target file.");
    
    var content=this.getFileContent(fn);
    if(content===null)return this._wrapDualFormat('File "'+fn+'" not found.','File "'+fn+'" not found.');
    
    var lines=content.split('\n');
    this.pushUndo(fn,content);
    
    var ln=Math.max(1,parseInt(args.line_number)||1);
    var count=Math.max(1,parseInt(args.count)||1);
    
    if(ln>lines.length){
      return this._wrapDualFormat("Line "+ln+" out of range (1-"+lines.length+").","Line "+ln+" out of range (1-"+lines.length+").");
    }
    
    var end=Math.min(ln+count-1,lines.length);
    var deleted=lines.splice(ln-1,end-ln+1);
    
    var newContent=lines.join('\n');
    this.setFileContent(fn,newContent);
    this._editBuffer=newContent;
    this._editTarget=fn;
    
    var msg="**🗑️ Deleted "+deleted.length+" line(s) starting at line "+ln+"** from `"+fn+"` — **"+lines.length+" lines** remaining.\n📂 **Editing:** `"+fn+"` (v"+this._getVersionCount(fn)+", "+lines.length+" lines)";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- append_lines ---
  if(action==="append_lines"){
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn)return this._wrapDualFormat("No target file.","No target file.");
    
    var content=this.getFileContent(fn);
    if(content===null)content="";
    
    this.pushUndo(fn,content);
    
    var append=args.new_code||args.content||"";
    var newContent=content?(content+"\n"+append):append;
    
    this.setFileContent(fn,newContent);
    this._editBuffer=newContent;
    this._editTarget=fn;
    
    var lines=newContent.split('\n').length;
    var addedLines=append.split('\n').length;
    
    var msg="**📎 Appended "+addedLines+" line(s)** to `"+fn+"` — **"+lines+" lines** total.\n📂 **Editing:** `"+fn+"` (v"+this._getVersionCount(fn)+", "+lines+" lines)";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- list_files ---
  if(action==="list_files"){
    var chatId=this._getChatId();
    var files=this._getFilesForChat(chatId);
    
    if(files.length===0){
      return this._wrapDualFormat(
        "📂 **ScratchPad: empty**\n\nNo files yet. Use `write_file` or `load_source` to add files.\n📂 **0 files** in ScratchPad",
        "📂 **ScratchPad: empty**\n\nNo files yet. Use `write_file` or `load_source` to add files.\n📂 **0 files** in ScratchPad"
      );
    }
    
    var lines=["📂 **ScratchPad Files** ("+files.length+" total):",""];
    for(var i=0;i<files.length;i++){
      var f=files[i];
      var isActive=f.id===this._active?" ← active":"";
      var size=this._formatSize((f.content||"").length);
      var flines=(f.content||"").split('\n').length;
      lines.push((i+1)+". `"+f.filename+"` — **"+flines+" lines**, "+size+isActive);
    }
    lines.push("");
    lines.push("📂 **"+files.length+" files** in ScratchPad | Use `set_target_file` to switch | `read_file` to view");
    
    var msg=lines.join("\n");
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- search_code ---
  if(action==="search_code"){
    var pattern=args.pattern||args.content;
    if(!pattern){
      return this._wrapDualFormat(
        "Specify a `pattern` to search for.",
        "Specify a `pattern` to search for."
      );
    }
    
    var isRegex=!!args.is_regex;
    var chatId=this._getChatId();
    var files=this._getFilesForChat(chatId);
    var results=[];
    
    try{
      var regex=isRegex?new RegExp(pattern,'g'):new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
      
      for(var fi=0;fi<files.length;fi++){
        var f=files[fi];
        var content=f.content||"";
        var found=false;
        var match;
        while((match=regex.exec(content))!==null){
          var lineNum=content.substring(0,match.index).split('\n').length;
          var lineContent=content.split('\n')[lineNum-1]||"";
          results.push({file:f.filename,line:lineNum,text:lineContent.trim().substring(0,120)});
          found=true;
          if(results.length>=50)break;
        }
        if(results.length>=50)break;
      }
    }catch(ex){
      return this._wrapDualFormat("Search error: "+ex.message,"Search error: "+ex.message);
    }
    
    if(results.length===0){
      return this._wrapDualFormat(
        'No matches for "'+pattern+'" in any file.',
        'No matches for "'+pattern+'" in any file.'
      );
    }
    
    // Build results with truncation for UI
    var modelLines=["## Search Results: \""+pattern+"\" ("+results.length+" matches)",""];
    var uiLines=["## Search Results: \""+pattern+"\" ("+results.length+" matches)",""];
    var showAll=results.length<=30;
    
    for(var ri=0;ri<results.length;ri++){
      var r=results[ri];
      var entry=(ri+1)+". `"+r.file+"`:"+r.line+" — `"+this._escapeHTML(r.text)+"`";
      modelLines.push(entry);
      if(showAll||ri<30)uiLines.push(entry);
    }
    
    if(!showAll){
      uiLines.push("");
      uiLines.push("*... and "+(results.length-30)+" more matches (full results available to AI)*");
    }
    
    return this._wrapDualFormat(modelLines.join("\n"),uiLines.join("\n"));
  }
  
  // --- analyze ---
  if(action==="analyze"){
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn){
      return this._wrapDualFormat(
        "No file to analyze. Specify `target_filename` or use `set_target_file` first.",
        "No file to analyze. Specify `target_filename` or use `set_target_file` first."
      );
    }
    
    var content=this.getFileContent(fn);
    if(content===null){
      return this._wrapDualFormat(
        'File "'+fn+'" not found.',
        'File "'+fn+'" not found.'
      );
    }
    
    var lines=content.split('\n');
    var lang=this._detectLanguage(fn);
    var charCount=content.length;
    var emptyLines=0;
    var commentLines=0;
    var codeLines=0;
    
    for(var i=0;i<lines.length;i++){
      var trimmed=lines[i].trim();
      if(trimmed===""){emptyLines++;continue;}
      if(trimmed.indexOf("//")===0||trimmed.indexOf("#")===0||trimmed.indexOf("/*")===0||trimmed.indexOf("*")===0||trimmed.indexOf("--")===0){commentLines++;continue;}
      codeLines++;
    }
    
    var modelMsg="## Analysis: `"+fn+"`\n\n- **Language:** "+lang+"\n- **Total lines:** "+lines.length+"\n- **Code lines:** "+codeLines+"\n- **Comment lines:** "+commentLines+"\n- **Empty lines:** "+emptyLines+"\n- **Characters:** "+charCount+"\n- **File size:** "+this._formatSize(charCount);
    var uiMsg=modelMsg; // Analysis is always small
    
    return this._wrapDualFormat(modelMsg,uiMsg);
  }
  
  // --- diff ---
  if(action==="diff"){
    // Compare file to a previous version
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn){
      return this._wrapDualFormat(
        "Specify `target_filename` to diff.",
        "Specify `target_filename` to diff."
      );
    }
    
    var current=this.getFileContent(fn);
    if(current===null){
      return this._wrapDualFormat('File "'+fn+'" not found.','File "'+fn+'" not found.');
    }
    
    // Get last version from undo stack
    var prev=null;
    for(var i=this._undoStack.length-1;i>=0;i--){
      if(this._undoStack[i].filename===fn){
        prev=this._undoStack[i].content;
        break;
      }
    }
    
    if(prev===null){
      return this._wrapDualFormat(
        'No previous version of "'+fn+'" in undo history.',
        'No previous version of "'+fn+'" in undo history.'
      );
    }
    
    // Simple line-based diff
    var prevLines=prev.split('\n');
    var currLines=current.split('\n');
    var diffLines=[];
    var maxLen=Math.max(prevLines.length,currLines.length);
    
    for(var i=0;i<maxLen;i++){
      var p=prevLines[i]||"";
      var c=currLines[i]||"";
      if(p!==c){
        if(p)diffLines.push("- "+p);
        if(c)diffLines.push("+ "+c);
      }
    }
    if(diffLines.length===0)diffLines.push("(no differences)");
    
    var modelContent="## Diff: `"+fn+"` ("+diffLines.length+" changes)\n\n```diff\n"+diffLines.join('\n')+"\n```";
    
    // Truncate UI if too many diff lines
    if(diffLines.length>80){
      var uiDiff=diffLines.slice(0,80);
      var extra=diffLines.length-80;
      uiDiff.push("... and "+extra+" more changes");
      var uiContent="## Diff: `"+fn+"` ("+diffLines.length+" changes, showing first 80)\n\n```diff\n"+uiDiff.join('\n')+"\n```";
      return this._wrapDualFormat(modelContent,uiContent);
    }
    
    return this._wrapDualFormat(modelContent,modelContent);
  }
  
  // --- refactor ---
  if(action==="refactor"){
    var fn=args.target_filename||args.new_filename||this._editTarget;
    if(!fn){
      return this._wrapDualFormat(
        "Specify `target_filename` to refactor.",
        "Specify `target_filename` to refactor."
      );
    }
    
    var content=this.getFileContent(fn);
    if(content===null){
      return this._wrapDualFormat('File "'+fn+'" not found.','File "'+fn+'" not found.');
    }
    
    this.pushUndo(fn,content);
    
    var newCode=args.new_code||args.content;
    if(!newCode){
      return this._wrapDualFormat(
        "Provide `new_code` with the refactored version.",
        "Provide `new_code` with the refactored version."
      );
    }
    
    this.setFileContent(fn,newCode);
    this._editBuffer=newCode;
    this._editTarget=fn;
    
    var oldLines=content.split('\n').length;
    var newLines=newCode.split('\n').length;
    
    var msg="**🔧 Refactored:** `"+fn+"` ("+oldLines+" lines → "+newLines+" lines).\n📂 **Editing:** `"+fn+"` (v"+this._getVersionCount(fn)+", "+newLines+" lines)";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  // --- write_source ---
  if(action==="write_source"){
    var newCode=args.new_code||args.content;
    if(!newCode){
      return this._wrapDualFormat(
        "Provide `new_code` with the complete source.",
        "Provide `new_code` with the complete source."
      );
    }
    
    // Save current source first
    this.saveFileVersion("chatseed.html",document.documentElement.outerHTML,"Backup before write_source");
    
    // Write to scratchpad
    this.addOrUpdateFile("chatseed.html",newCode,"text/html");
    this._editTarget="chatseed.html";
    this._editBuffer=newCode;
    
    var lines=newCode.split('\n').length;
    
    var msg="**📝 Source written to ScratchPad:** `chatseed.html` — **"+lines+" lines**.\n\nTo apply this to the running page, I would need to write it using write_file then ask you to reload.\n📂 **Editing:** `chatseed.html` (v"+this._getVersionCount("chatseed.html")+", "+lines+" lines)";
    
    return this._wrapDualFormat(msg,msg);
  }
  
  return this._wrapDualFormat(
    'Unknown action: "'+action+'". Available: load_source, read, read_file, read_lines, write_file, write, edit_lines, insert_lines, delete_lines, append_lines, list_files, search_code, analyze, diff, refactor, set_target_file, write_source.',
    'Unknown action: "'+action+'". Available: load_source, read, read_file, read_lines, write_file, write, edit_lines, insert_lines, delete_lines, append_lines, list_files, search_code, analyze, diff, refactor, set_target_file, write_source.'
  );
},

// ===== HELPERS =====
_listFileNames:function(){
  var chatId=this._getChatId();
  var files=this._getFilesForChat(chatId);
  var names=[];
  for(var i=0;i<files.length;i++){
    names.push('"'+files[i].filename+'"');
  }
  return names.join(", ")||"(none)";
},

_getVersionCount:function(filename){
  var count=1;
  for(var i=0;i<this._files.length;i++){
    if(this._files[i].filename===filename)count++;
  }
  return count;
},

_detectLanguage:function(filename){
  var ext=filename.split('.').pop().toLowerCase();
  var langMap={
    html:"html",htm:"html",js:"javascript",jsx:"javascript",ts:"typescript",tsx:"typescript",
    css:"css",scss:"scss",less:"less",json:"json",py:"python",rb:"ruby",
    java:"java",c:"c",cpp:"cpp",h:"c",hpp:"cpp",cs:"csharp",go:"go",
    rs:"rust",php:"php",swift:"swift",kt:"kotlin",scala:"scala",
    sh:"bash",bash:"bash",zsh:"bash",ps1:"powershell",bat:"batch",
    sql:"sql",md:"markdown",markdown:"markdown",xml:"xml",yaml:"yaml",
    yml:"yaml",toml:"toml",ini:"ini",cfg:"ini",conf:"ini",
    dockerfile:"dockerfile",makefile:"makefile",gradle:"groovy",
    lua:"lua",r:"r",pl:"perl",tex:"latex",svg:"xml",vue:"html",
    svelte:"html",astro:"html",dart:"dart",lisp:"lisp",clj:"clojure",
    erl:"erlang",hs:"haskell",nix:"nix",tf:"hcl",hcl:"hcl",
    prototxt:"protobuf",proto:"protobuf",graphql:"graphql",gql:"graphql",
    mjs:"javascript",cjs:"javascript",mts:"typescript",cts:"typescript"
  };
  return langMap[ext]||"";
}
};

// ===== WRAPPER FOR GLOBAL ACCESS =====
window.RightSidebar=_rs;
window.LineEditor=_rs;
window.FileManager=_rs;

// ===== EXPOSE handleEvolveSelfLineAction =====
window.handleEvolveSelfLineAction = function(args){
  try{
    return _rs.handleLineAction(args);
  }catch(ex){
    console.error("handleEvolveSelfLineAction error:",ex);
    return JSON.stringify({
      model:"Error: "+ex.message,
      ui:"Error: "+ex.message+"\n\nCheck console for details."
    });
  }
};

// ===== UNDO SYSTEM (global) =====
window.undoLastWrite = function(){
  try{
    var undo=_rs.popUndo();
    if(!undo){
      if(typeof showToast==="function")showToast("Nothing to undo");
      return;
    }
    var existing=_rs.getFileContent(undo.filename);
    if(existing!==null){
      _rs.pushUndo(undo.filename,existing);
    }
    _rs.setFileContent(undo.filename,undo.content);
    _rs._editTarget=undo.filename;
    _rs._editBuffer=undo.content;
    _rs.render();
    if(typeof showToast==="function")showToast("Undo: "+undo.filename);
  }catch(ex){console.error("undo error:",ex);}
};

// ===== INIT =====
_rs._load();
_rs.initLineEditor();

// Load for current chat
if(typeof currentChatId!=="undefined"&&currentChatId){
  _rs.loadForChat(currentChatId);
}

console.log("ChatSeed Files v2.1 loaded (safe code display)");
})();
