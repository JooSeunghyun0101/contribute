// 추가 상세 페이지들
// - 피평가자: 내 과업 상세 (리스트+상세+이력+과업 등록)
// - 피평가자: 과업 일정 / 피드백 이력
// - 평가자: 담당 팀원 / 직원별 점수 테이블 / 전체 일정 / 피드백 내역
// - HR: 부서별 진행 / 사용자 관리 / 시스템 설정

const { useState: uS, useMemo: uM } = React;
const MM = window.OK_MOCK;

// ============================================================
// 공용 — 점수 숫자 배지 (1~4)
// ============================================================
const NumBadge = ({ score, size=28 }) => {
  if(score==null) return <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
    <span style={{width:size,height:size,borderRadius:8,background:'var(--n-100)',color:'var(--fg-subtle)',fontWeight:700,fontSize:size>28?14:12,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>—</span>
  </span>;
  const col={4:'#F55000',3:'#D94400',2:'#FFAA00',1:'#C2BAB0'}[score];
  return <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
    <span style={{width:size,height:size,borderRadius:8,background:col,color:'#fff',fontWeight:900,fontSize:Math.round(size*0.52),display:'inline-flex',alignItems:'center',justifyContent:'center'}} className="tnum">{score}</span>
  </span>;
};

// ============================================================
// 1. 피평가자 — 내 과업 상세 (/tasks)
// ============================================================
const MyTasksPage = () => {
  const [sel,setSel] = uS(0);
  const [showAdd,setShowAdd] = uS(false);
  const tasks = MM.myTasks;
  const t = tasks[sel];
  const totalWeight = tasks.reduce((s,x)=>s+x.weight,0);

  return <div style={{flex:1,display:'flex',overflow:'hidden'}}>
    {/* 좌측: 과업 리스트 */}
    <div style={{width:340,borderRight:'1px solid var(--border)',background:'var(--bg-card)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'18px 20px 14px',borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div className="label-mini">MY TASKS</div>
            <h3 style={{marginTop:2,fontSize:16}}>내 과업 <span style={{color:'var(--fg-muted)',fontWeight:500,fontSize:13}}>{tasks.length}건</span></h3>
          </div>
          <button className="btn btn-primary btn-sm" onClick={()=>setShowAdd(true)}><I.plus width={14} height={14}/> 등록</button>
        </div>
        <div style={{marginTop:10,padding:'8px 10px',background:'var(--bg-muted)',borderRadius:8,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11}}>
          <span style={{color:'var(--fg-muted)',fontWeight:600}}>총 가중치</span>
          <span className="tnum fw-7" style={{color: totalWeight===100?'var(--success)':'var(--warning)'}}>{totalWeight}%</span>
        </div>
      </div>
      <div style={{flex:1,overflow:'auto'}}>
        {tasks.map((tt,i)=>(
          <div key={tt.id} onClick={()=>setSel(i)} style={{
            padding:'14px 20px',borderBottom:'1px solid var(--border)',cursor:'pointer',
            background:i===sel?'var(--ok-orange-50)':'transparent',
            borderLeft:i===sel?'3px solid var(--ok-orange)':'3px solid transparent',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <Pill tone={tt.score==null?'neutral':'orange'}>T{String(i+1).padStart(2,'0')}</Pill>
              <NumBadge score={tt.score} size={22}/>
            </div>
            <div style={{fontWeight:i===sel?700:600,fontSize:13,lineHeight:1.45}}>{tt.title}</div>
            <div style={{fontSize:11,color:'var(--fg-muted)',marginTop:6,display:'flex',gap:8}}>
              <span>{tt.method}·{tt.scope}</span>
              <span style={{color:'var(--fg-subtle)'}}>·</span>
              <span>가중치 {tt.weight}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* 우측: 과업 상세 */}
    <div style={{flex:1,overflow:'auto'}}>
      {showAdd ? <AddTaskPanel onClose={()=>setShowAdd(false)}/> : <TaskDetail task={t} idx={sel}/>}
    </div>
  </div>;
};

const TaskDetail = ({ task, idx }) => {
  const [editing,setEditing] = uS(false);
  const [form,setForm] = uS({title:task.title,desc:task.desc,method:task.method,scope:task.scope,weight:task.weight,start:task.start,end:task.end});
  React.useEffect(()=>{ setForm({title:task.title,desc:task.desc,method:task.method,scope:task.scope,weight:task.weight,start:task.start,end:task.end}); setEditing(false); },[task.id]);

  const scoreFromMatrix = (() => {
    const mi = MM.methods.indexOf(form.method==='주도'?'총괄/주도':form.method==='리딩'?'리딩':form.method==='협업'?'실무':form.method==='실무'?'실무':form.method==='지원'?'지원':form.method);
    const si = MM.scopes.indexOf(form.scope==='전사'?'전사/그룹':form.scope);
    if(mi<0||si<0) return task.score;
    return MM.scoreMatrix[mi]?.[si] ?? task.score;
  })();

  return <div style={{padding:'28px 32px',display:'flex',flexDirection:'column',gap:18}}>
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <Pill tone="orange">T{String(idx+1).padStart(2,'0')}</Pill>
        <Pill tone="neutral">가중치 {task.weight}%</Pill>
        <Pill tone={task.score==null?'warning':'success'}>{task.score==null?'평가 대기':'평가 완료'}</Pill>
        <span style={{flex:1}}/>
        {!editing
          ? <button className="btn btn-outline btn-sm" onClick={()=>setEditing(true)}>수정 요청</button>
          : <div style={{display:'flex',gap:6}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(false)}>취소</button>
              <button className="btn btn-primary btn-sm" onClick={()=>setEditing(false)}><I.check width={14} height={14}/> 수정 요청 전송</button>
            </div>}
      </div>
      {editing
        ? <input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} style={{fontSize:22,fontWeight:800,padding:'10px 12px'}}/>
        : <h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>{task.title}</h1>}
    </div>

    <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:18}}>
      {/* 본문 */}
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="card-lg">
          <div className="label-mini">과업 설명</div>
          {editing
            ? <textarea className="textarea" rows="4" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})} style={{marginTop:10}}/>
            : <p style={{marginTop:10,fontSize:14,lineHeight:1.7,color:'var(--fg)'}}>{task.desc}</p>}

          <div style={{marginTop:18,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
            {[
              {label:'기여 방식', key:'method', opts:MM.methods, val:form.method},
              {label:'기여 범위', key:'scope', opts:MM.scopes, val:form.scope},
              {label:'가중치', key:'weight', val:form.weight+'%'},
              {label:'기간', key:'range', val:`${task.start.slice(5)} ~ ${task.end.slice(5)}`},
            ].map(f=>(
              <div key={f.label} style={{padding:12,background:'var(--bg-muted)',borderRadius:10}}>
                <div className="label-mini">{f.label}</div>
                {editing && f.opts
                  ? <select className="input" value={f.val} onChange={e=>setForm({...form,[f.key]:e.target.value})} style={{marginTop:6,padding:'6px 8px',fontSize:13}}>
                      {f.opts.map(o=><option key={o}>{o}</option>)}
                    </select>
                  : editing && f.key==='weight'
                  ? <input className="input tnum" type="number" value={form.weight} onChange={e=>setForm({...form,weight:+e.target.value})} style={{marginTop:6,padding:'6px 8px',fontSize:13,width:'100%'}}/>
                  : <div style={{marginTop:4,fontWeight:700,fontSize:13}}>{f.val}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="card-lg">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div><div className="label-mini">피드백 이력</div><h4 style={{marginTop:2}}>{(task.history||[]).length}건의 평가자 코멘트</h4></div>
            {task.evaluator && <div style={{fontSize:12,color:'var(--fg-muted)'}}>평가자 · <b style={{color:'var(--fg)'}}>{task.evaluator}</b></div>}
          </div>
          {(task.history||[]).length===0
            ? <div style={{padding:'32px 20px',textAlign:'center',color:'var(--fg-subtle)',background:'var(--bg-muted)',borderRadius:10}}>
                <I.msg width={28} height={28} style={{opacity:0.4}}/>
                <div style={{marginTop:8,fontSize:13}}>아직 작성된 피드백이 없습니다</div>
              </div>
            : <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {(task.history||[]).map((h,i)=>(
                  <div key={h.id} style={{padding:14,border:'1px solid var(--border)',borderRadius:10,position:'relative'}}>
                    {i===0 && <span style={{position:'absolute',top:12,right:12}}><Pill tone="orange">최신</Pill></span>}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div className="avatar sm">{h.evaluator[0]}</div>
                        <div>
                          <div style={{fontWeight:700,fontSize:13}}>{h.evaluator}</div>
                          <div style={{fontSize:11,color:'var(--fg-subtle)'}} className="tnum">{h.date}</div>
                        </div>
                      </div>
                    </div>
                    <p style={{fontSize:13,lineHeight:1.65,color:'var(--fg)',margin:0}}>{h.content}</p>
                  </div>
                ))}
              </div>}
        </div>
      </div>

      {/* 사이드 */}
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="card-lg" style={{padding:18,textAlign:'center'}}>
          <div className="label-mini">현재 점수</div>
          <div style={{marginTop:12,display:'flex',justifyContent:'center'}}>
            <NumBadge score={task.score} size={72}/>
          </div>
          <div style={{marginTop:10,fontSize:12,color:'var(--fg-muted)'}}>{task.method} × {task.scope} 기반</div>
          {task.score && <div style={{marginTop:14,padding:'10px 12px',background:'var(--ok-orange-50)',borderRadius:8,fontSize:12,color:'var(--ok-brown)',textAlign:'left'}}>
            <b>산출 근거</b> · 매트릭스 [{MM.methods.indexOf(task.method==='주도'?'총괄/주도':task.method)+1},{MM.scopes.indexOf(task.scope==='전사'?'전사/그룹':task.scope)+1}] = <b>{task.score}점</b>
          </div>}
        </div>

        <div className="card">
          <div className="label-mini">일정</div>
          <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8,fontSize:13}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--fg-muted)'}}>시작</span><b className="tnum">{task.start}</b></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--fg-muted)'}}>종료</span><b className="tnum">{task.end}</b></div>
            <div className="bar" style={{marginTop:6,height:5}}>
              <div className="fill" style={{width: task.score?'100%':'65%'}}/>
            </div>
          </div>
        </div>

        <div className="card" style={{background:'var(--ok-orange-50)',border:'1px solid var(--ok-orange-100)'}}>
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <div style={{color:'var(--ok-orange)'}}><I.sparkle width={18} height={18}/></div>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:'var(--ok-brown)'}}>AI 성장 제안</div>
              <div style={{fontSize:12,lineHeight:1.6,color:'var(--ok-brown)',marginTop:4}}>
                {task.score===4
                  ? '탁월한 성과입니다. 다음 분기에는 본 과업의 방법론을 타 부서에 공유하는 확산 역할을 고려해보세요.'
                  : task.score===3
                  ? '우수한 수행. 기여 범위를 한 단계 넓히면 S급 도달이 가능합니다.'
                  : task.score==null
                  ? '아직 평가 전입니다. 중간 점검 요청을 보내면 조기 피드백을 받을 수 있어요.'
                  : '기본 역할은 수행됨. 기여 방식을 "주도"로 끌어올릴 기회를 찾아보세요.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>;
};

const AddTaskPanel = ({ onClose }) => {
  const [goal,setGoal] = uS('');
  const [suggested,setSuggested] = uS(null);
  const [loading,setLoading] = uS(false);
  const [form,setForm] = uS({title:'',desc:'',method:'리딩',scope:'팀',weight:15,start:'2026-05-01',end:'2026-06-30'});

  const runAI = () => {
    if(!goal.trim()) return;
    setLoading(true);
    setTimeout(()=>{
      const sugg = [
        {title:`${goal.slice(0,20)} · 실행 로드맵 수립`, desc:`${goal} 목표 달성을 위한 4단계 로드맵을 수립하고, 이해관계자와 얼라인먼트를 확보합니다. KPI 및 마일스톤 포함.`, method:'리딩',scope:'팀',weight:20},
        {title:`${goal.slice(0,18)} — 현황 진단/벤치마킹`, desc:`현재 수준을 객관적으로 진단하고 업계 벤치마크를 수집·분석하여 개선 포인트를 도출합니다.`, method:'실무',scope:'팀',weight:15},
        {title:`${goal.slice(0,15)} 파일럿 실행`, desc:`작은 범위로 파일럿을 설계·실행하고 정량 효과를 측정하여 확산 여부를 판단합니다.`, method:'주도',scope:'본부',weight:25},
      ];
      setSuggested(sugg);
      setLoading(false);
    },700);
  };

  const pick = (s) => setForm({...form,title:s.title,desc:s.desc,method:s.method,scope:s.scope,weight:s.weight});

  return <div style={{padding:'28px 32px',display:'flex',flexDirection:'column',gap:18}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
      <div>
        <Pill tone="orange">NEW TASK</Pill>
        <h1 style={{marginTop:10,fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>새 과업 등록</h1>
        <p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>목표를 입력하면 AI가 과업 후보를 제안합니다. 선택 후 수정·제출할 수 있어요.</p>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onClose}><I.x width={14} height={14}/> 닫기</button>
    </div>

    <div className="card-lg" style={{background:'linear-gradient(135deg,#FFF5EE 0%,#FFFBF5 100%)',border:'1px solid var(--ok-orange-100)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <div style={{color:'var(--ok-orange)'}}><I.sparkle width={20} height={20}/></div>
        <b style={{fontSize:15}}>AI 과업 제안</b>
        <span style={{fontSize:11,color:'var(--fg-muted)'}}>· 달성하고 싶은 목표 한 줄</span>
      </div>
      <div style={{display:'flex',gap:8}}>
        <input className="input" placeholder="예: 팀 온보딩 소요시간을 절반으로 줄이기" value={goal} onChange={e=>setGoal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')runAI();}} style={{flex:1}}/>
        <button className="btn btn-primary" onClick={runAI} disabled={loading||!goal.trim()}>
          {loading ? '생각 중…' : <><I.sparkle width={14} height={14}/> 제안 받기</>}
        </button>
      </div>

      {suggested && <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {suggested.map((s,i)=>(
          <button key={i} onClick={()=>pick(s)} style={{
            textAlign:'left',padding:14,background:'#fff',borderRadius:10,border:form.title===s.title?'2px solid var(--ok-orange)':'1px solid var(--border)',cursor:'pointer',
            boxShadow:form.title===s.title?'var(--sh-sm)':'none'
          }}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <Pill tone="orange">#{i+1}</Pill>
              <NumBadge score={MM.scoreMatrix[MM.methods.indexOf(s.method==='주도'?'총괄/주도':s.method)]?.[MM.scopes.indexOf(s.scope==='전사'?'전사/그룹':s.scope)]} size={20}/>
            </div>
            <div style={{fontWeight:700,fontSize:13,lineHeight:1.4,marginBottom:6}}>{s.title}</div>
            <div style={{fontSize:11,color:'var(--fg-muted)',lineHeight:1.55,height:40,overflow:'hidden'}}>{s.desc}</div>
            <div style={{marginTop:8,fontSize:10,color:'var(--fg-subtle)'}}>{s.method} · {s.scope} · {s.weight}%</div>
          </button>
        ))}
      </div>}
    </div>

    <div className="card-lg">
      <h4>과업 내용 <span style={{color:'var(--fg-muted)',fontWeight:500,fontSize:12}}>· 직접 작성하거나 위 제안을 선택하세요</span></h4>
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:12}}>
        <div className="field"><label>과업 제목</label><input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="예: 상반기 HR 대시보드 고도화"/></div>
        <div className="field"><label>상세 설명</label><textarea className="textarea" rows="4" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})} placeholder="배경, 목표, 방법론, 기대효과 등을 자유롭게 기술"/></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
          <div className="field"><label>기여 방식</label><select className="input" value={form.method} onChange={e=>setForm({...form,method:e.target.value})}>{MM.methods.map(m=><option key={m}>{m}</option>)}</select></div>
          <div className="field"><label>기여 범위</label><select className="input" value={form.scope} onChange={e=>setForm({...form,scope:e.target.value})}>{MM.scopes.map(m=><option key={m}>{m}</option>)}</select></div>
          <div className="field"><label>가중치 (%)</label><input className="input tnum" type="number" value={form.weight} onChange={e=>setForm({...form,weight:+e.target.value})}/></div>
          <div className="field"><label>예상 점수</label><div style={{marginTop:4}}><NumBadge score={MM.scoreMatrix[MM.methods.indexOf(form.method)]?.[MM.scopes.indexOf(form.scope)]} size={36}/></div></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div className="field"><label>시작일</label><input className="input tnum" type="date" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></div>
          <div className="field"><label>종료일</label><input className="input tnum" type="date" value={form.end} onChange={e=>setForm({...form,end:e.target.value})}/></div>
        </div>
      </div>
      <div style={{marginTop:18,padding:14,background:'var(--ok-orange-50)',borderRadius:10,display:'flex',gap:10,alignItems:'flex-start'}}>
        <div style={{color:'var(--ok-orange)',flexShrink:0}}><I.sparkle width={16} height={16}/></div>
        <div style={{fontSize:12,lineHeight:1.6,color:'var(--ok-brown)',flex:1}}>
          <b>AI 검토</b> · 이 과업은 평가자(박판근 부장)의 승인 후 매트릭스에 반영됩니다. 현재 총 가중치는 <b>{MM.myTasks.reduce((s,x)=>s+x.weight,0) + (form.weight||0)}%</b>이며, 100% 초과 시 기존 과업 가중치를 조정해야 합니다.
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:14}}>
        <button className="btn btn-outline btn-sm" onClick={onClose}>취소</button>
        <button className="btn btn-outline btn-sm">임시 저장</button>
        <button className="btn btn-primary btn-sm"><I.send width={14} height={14}/> 평가자에게 제출</button>
      </div>
    </div>
  </div>;
};

// ============================================================
// 2. 피평가자 — 과업 일정 (/schedule)
// ============================================================
const MySchedulePage = () => {
  const months = ['1월','2월','3월','4월','5월','6월'];
  const colors = ['#F55000','#FFAA00','#D94400','#55474A'];
  return <div style={{padding:'28px 32px',display:'flex',flexDirection:'column',gap:18}}>
    <div>
      <div className="label-mini">SCHEDULE</div>
      <h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em',marginTop:4}}>과업 일정</h1>
      <p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>상반기 타임라인 · 오늘 기준 진행률</p>
    </div>
    <div className="card-lg">
      <div style={{display:'grid',gridTemplateColumns:'180px 1fr 80px',gap:14,alignItems:'center',paddingBottom:10,borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--fg-muted)',fontWeight:700,letterSpacing:'0.06em'}}>
        <div>과업</div>
        <div style={{display:'grid',gridTemplateColumns:`repeat(${months.length},1fr)`,gap:0}}>{months.map(m=><div key={m} style={{textAlign:'center'}}>{m}</div>)}</div>
        <div style={{textAlign:'right'}}>점수</div>
      </div>
      <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:10,position:'relative'}}>
        {MM.myTasks.map((t,i)=>{
          const sm=parseInt(t.start.slice(5,7))-1+parseInt(t.start.slice(8,10))/30;
          const em=parseInt(t.end.slice(5,7))-1+parseInt(t.end.slice(8,10))/30;
          const left=sm/6*100, w=(em-sm)/6*100;
          return <div key={t.id} style={{display:'grid',gridTemplateColumns:'180px 1fr 80px',gap:14,alignItems:'center'}}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <Pill tone="neutral">T{String(i+1).padStart(2,'0')}</Pill>
              <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div>
            </div>
            <div style={{position:'relative',height:28,background:'var(--bg-muted)',borderRadius:6}}>
              {months.map((_,mi)=><div key={mi} style={{position:'absolute',top:0,bottom:0,left:`${mi*100/6}%`,width:1,background:'var(--border)'}}/>)}
              <div style={{position:'absolute',top:3,bottom:3,left:`${left}%`,width:`${w}%`,background:colors[i%4],borderRadius:4,display:'flex',alignItems:'center',padding:'0 8px',color:'#fff',fontSize:11,fontWeight:700}}>
                {t.method} · {t.scope}
              </div>
            </div>
            <div style={{textAlign:'right'}}><NumBadge score={t.score} size={22}/></div>
          </div>;
        })}
        <div style={{position:'absolute',top:-4,bottom:-4,left:`calc(180px + 14px + ${3.7/6*100}% * (100% - 180px - 14px - 80px - 14px) / 100%)`,width:2,background:'var(--ok-orange)',zIndex:2,pointerEvents:'none'}}>
          <div style={{position:'absolute',top:-16,left:-16,fontSize:10,fontWeight:800,color:'var(--ok-orange)',background:'#fff',padding:'1px 6px',borderRadius:4,border:'1px solid var(--ok-orange)'}}>오늘</div>
        </div>
      </div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
      <StatCard icon={I.target} label="전체 과업" value={MM.myTasks.length}/>
      <StatCard icon={I.check} label="평가 완료" value={MM.myTasks.filter(t=>t.score!=null).length}/>
      <StatCard icon={I.clock} label="진행 중" value={MM.myTasks.filter(t=>t.score==null).length}/>
      <StatCard icon={I.calendar} label="마감까지" value="D-7" accent/>
    </div>
  </div>;
};

// ============================================================
// 3. 피평가자 — 피드백 이력 (/feedback)
// ============================================================
const MyFeedbackPage = () => {
  const all = MM.myTasks.flatMap((t,ti)=>(t.history||[]).map(h=>({...h,taskTitle:t.title,taskIdx:ti,score:t.score,method:t.method,scope:t.scope})));
  all.sort((a,b)=>b.date.localeCompare(a.date));
  return <div style={{padding:'28px 32px',display:'flex',flexDirection:'column',gap:18}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
      <div>
        <div className="label-mini">FEEDBACK · 2026 H1</div>
        <h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em',marginTop:4}}>피드백 이력</h1>
        <p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>평가자로부터 받은 코멘트 {all.length}건 · 시간순</p>
      </div>
      <div style={{display:'flex',gap:6}}>
        <Pill tone="orange">{all.length}건</Pill>
        <button className="btn btn-outline btn-sm">내보내기</button>
      </div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:18}}>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {all.map((h,i)=>(
          <div key={h.id} className="card" style={{padding:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div className="avatar">{h.evaluator[0]}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{h.evaluator}</div>
                  <div style={{fontSize:11,color:'var(--fg-subtle)'}} className="tnum">{h.date}</div>
                </div>
              </div>
              <NumBadge score={h.score} size={26}/>
            </div>
            <div style={{padding:10,background:'var(--bg-muted)',borderRadius:8,marginBottom:10}}>
              <Pill tone="neutral">T{String(h.taskIdx+1).padStart(2,'0')}</Pill>
              <span style={{marginLeft:8,fontWeight:700,fontSize:13}}>{h.taskTitle}</span>
              <span style={{marginLeft:8,fontSize:11,color:'var(--fg-muted)'}}>· {h.method} / {h.scope}</span>
            </div>
            <p style={{fontSize:13,lineHeight:1.7,margin:0}}>{h.content}</p>
          </div>
        ))}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="card">
          <div className="label-mini">평가자</div>
          <div style={{marginTop:10,display:'flex',alignItems:'center',gap:10,padding:10,background:'var(--bg-muted)',borderRadius:8}}>
            <div className="avatar">박</div>
            <div><div style={{fontWeight:700,fontSize:13}}>박판근 부장</div><div style={{fontSize:11,color:'var(--fg-muted)'}}>인사기획팀 · Lv.4</div></div>
          </div>
        </div>
        <div className="card">
          <div className="label-mini">키워드</div>
          <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
            {['주도적','실행력','협업','수치 기반','속도','정책화','전사 영향'].map(k=>
              <span key={k} style={{padding:'4px 10px',background:'var(--ok-orange-50)',color:'var(--ok-brown)',borderRadius:999,fontSize:11,fontWeight:700}}>{k}</span>
            )}
          </div>
        </div>
        <div className="card" style={{background:'var(--ok-orange-50)',border:'1px solid var(--ok-orange-100)'}}>
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <div style={{color:'var(--ok-orange)'}}><I.sparkle width={18} height={18}/></div>
            <div style={{fontSize:12,lineHeight:1.65,color:'var(--ok-brown)'}}>
              <b>AI 요약</b> · 전반적으로 "주도성"과 "실행력"이 강점으로 평가되고 있습니다. 다음 라운드엔 "확산/공유" 관점의 활동이 추가되면 S급에 더 가까워질 수 있어요.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>;
};

// ============================================================
// 4. 평가자 — 담당 팀원 (/team) — 직원 카드 리스트
// ============================================================
const TeamMembersPage = ({ onOpenDetail }) => (
  <div style={{padding:24,display:'flex',flexDirection:'column',gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
      <div><h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>담당 팀원</h1><p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>내가 평가하는 인사기획팀 3명</p></div>
      <div style={{display:'flex',gap:6}}>
        <button className="btn btn-outline btn-sm">CSV 내보내기</button>
        <button className="btn btn-primary btn-sm"><I.sparkle width={14} height={14}/> AI 종합 리포트</button>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14}}>
      {MM.myTeam.map(m=>(
        <div key={m.id} className="card-lg" onClick={onOpenDetail} style={{padding:20,cursor:'pointer',position:'relative',overflow:'hidden'}}>
          {m.achieved && <div style={{position:'absolute',top:12,right:12}}><Pill tone="success">🎉 달성</Pill></div>}
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div className="avatar" style={{width:52,height:52,fontSize:20}}>{m.name[0]}</div>
            <div>
              <div style={{fontWeight:800,fontSize:16}}>{m.name} <span style={{color:'var(--fg-muted)',fontWeight:500,fontSize:13}}>{m.position}</span></div>
              <div style={{fontSize:12,color:'var(--fg-muted)'}}>{m.dept} · Lv.{m.level}</div>
            </div>
          </div>
          <div style={{display:'flex',gap:24,marginTop:18,alignItems:'center'}}>
            <div>
              <div className="label-mini">현재 점수</div>
              <div className="tnum" style={{fontSize:32,fontWeight:900,color:'var(--ok-orange)',lineHeight:1,marginTop:4}}>{m.score}</div>
            </div>
            <div style={{height:40,width:1,background:'var(--border)'}}/>
            <div style={{flex:1}}>
              <div className="label-mini">평가 진행률</div>
              <div style={{display:'flex',alignItems:'center',gap:10,marginTop:4}}>
                <div className="bar" style={{flex:1,height:8}}><div className="fill" style={{width:m.progress+'%',background:m.progress===100?'var(--success)':'var(--ok-orange)'}}/></div>
                <span className="tnum fw-7" style={{fontSize:13}}>{m.completed}/{m.total}</span>
              </div>
            </div>
          </div>
          <div style={{marginTop:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:11,color:'var(--fg-subtle)'}}>최근 활동 · {m.lastActivity}</span>
            <span style={{fontSize:12,color:'var(--ok-orange)',fontWeight:700,display:'flex',alignItems:'center',gap:4}}>상세 보기 <I.chevron width={14} height={14}/></span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ============================================================
// 5. 평가자 — 직원별 점수 테이블 (/scores)
// ============================================================
const ScoreTablePage = ({ onOpenDetail }) => {
  const rows = MM.myTeam;
  // 각 팀원마다 mock 과업 점수 4개 구성
  const taskScores = {
    'H1310172':[4,3,4,3],
    'H1411166':[3,2,3,null],
    'H1911042':[4,3,3,null],
  };
  const avg = s => { const f=s.filter(x=>x!=null); return f.length?(f.reduce((a,b)=>a+b,0)/f.length).toFixed(1):'-'; };

  return <div style={{padding:24,display:'flex',flexDirection:'column',gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
      <div><h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>직원별 점수</h1><p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>팀원별 과업 점수 한눈에 보기 · 셀 클릭 시 평가 상세</p></div>
      <div style={{display:'flex',gap:6}}>
        <button className="btn btn-outline btn-sm"><I.file width={14} height={14}/> CSV</button>
        <button className="btn btn-outline btn-sm">정렬: 평균 높은 순</button>
      </div>
    </div>

    <div className="card-lg" style={{padding:0,overflow:'hidden'}}>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead>
          <tr style={{background:'var(--bg-muted)',fontSize:11,color:'var(--fg-muted)',letterSpacing:'0.06em',textAlign:'left'}}>
            <th style={{padding:'14px 20px',fontWeight:700}}>직원</th>
            <th style={{padding:'14px 10px',fontWeight:700,textAlign:'center'}}>T01</th>
            <th style={{padding:'14px 10px',fontWeight:700,textAlign:'center'}}>T02</th>
            <th style={{padding:'14px 10px',fontWeight:700,textAlign:'center'}}>T03</th>
            <th style={{padding:'14px 10px',fontWeight:700,textAlign:'center'}}>T04</th>
            <th style={{padding:'14px 20px',fontWeight:700,textAlign:'center',background:'var(--ok-orange-50)',color:'var(--ok-orange)'}}>평균</th>
            <th style={{padding:'14px 16px',fontWeight:700,textAlign:'center'}}>진행률</th>
            <th style={{padding:'14px 16px',fontWeight:700,textAlign:'center'}}>달성</th>
            <th style={{padding:'14px 16px',fontWeight:700}}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m=>{
            const s = taskScores[m.id];
            return <tr key={m.id} style={{borderTop:'1px solid var(--border)'}}>
              <td style={{padding:'16px 20px'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div className="avatar sm">{m.name[0]}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{m.name} <span style={{color:'var(--fg-muted)',fontWeight:500,fontSize:12}}>{m.position}</span></div>
                    <div style={{fontSize:11,color:'var(--fg-subtle)'}}>{m.dept} · Lv.{m.level}</div>
                  </div>
                </div>
              </td>
              {s.map((sc,i)=>(
                <td key={i} style={{padding:'12px 10px',textAlign:'center',cursor:sc!=null?'pointer':'default'}} onClick={()=>sc!=null&&onOpenDetail&&onOpenDetail()}>
                  <div style={{display:'inline-flex'}}><NumBadge score={sc} size={32}/></div>
                </td>
              ))}
              <td style={{padding:'12px 20px',textAlign:'center',background:'var(--ok-orange-50)'}}>
                <div className="tnum" style={{fontSize:22,fontWeight:900,color:'var(--ok-orange)'}}>{avg(s)}</div>
                <div style={{fontSize:10,color:'var(--fg-muted)'}}>/ 4.0</div>
              </td>
              <td style={{padding:'12px 16px'}}>
                <div className="bar" style={{height:6,width:100,margin:'0 auto'}}><div className="fill" style={{width:m.progress+'%',background:m.progress===100?'var(--success)':'var(--ok-orange)'}}/></div>
                <div className="tnum" style={{fontSize:11,color:'var(--fg-muted)',textAlign:'center',marginTop:4}}>{m.completed}/{m.total} · {m.progress}%</div>
              </td>
              <td style={{padding:'12px 16px',textAlign:'center'}}>
                {m.achieved
                  ? <Pill tone="success">달성</Pill>
                  : <Pill tone="warning">미달</Pill>}
              </td>
              <td style={{padding:'12px 16px',textAlign:'right'}}>
                <button className="btn btn-outline btn-xs" onClick={onOpenDetail}>평가하기 <I.chevron width={12} height={12}/></button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    {/* 분포 요약 */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
      {[4,3,2,1].map(v=>{
        const all = Object.values(taskScores).flat().filter(x=>x!=null);
        const n = all.filter(x=>x===v).length;
        const col={4:'#F55000',3:'#D94400',2:'#FFAA00',1:'#C2BAB0'}[v];
        return <div key={v} className="card" style={{display:'flex',alignItems:'center',gap:14,padding:16}}>
          <div style={{width:44,height:44,borderRadius:10,background:col,color:'#fff',fontWeight:900,fontSize:22,display:'flex',alignItems:'center',justifyContent:'center'}} className="tnum">{v}</div>
          <div>
            <div style={{fontSize:11,color:'var(--fg-muted)',fontWeight:700,letterSpacing:'0.06em'}}>{v}점 분포</div>
            <div style={{fontSize:22,fontWeight:900}} className="tnum">{n}<span style={{fontSize:12,color:'var(--fg-muted)',fontWeight:600,marginLeft:4}}>/ {all.length}</span></div>
          </div>
        </div>;
      })}
    </div>
  </div>;
};

// ============================================================
// 6. 평가자 — 전체 일정 (/schedule)
// ============================================================
const EvaluatorSchedulePage = () => {
  const members = MM.myTeam;
  const months = ['1월','2월','3월','4월','5월','6월'];
  return <div style={{padding:24,display:'flex',flexDirection:'column',gap:16}}>
    <div>
      <h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>전체 일정</h1>
      <p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>팀원별 평가 데드라인 · 2026 상반기</p>
    </div>
    <div className="card-lg">
      <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14,paddingBottom:10,borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--fg-muted)',fontWeight:700,letterSpacing:'0.06em'}}>
        <div>팀원 / 과업</div>
        <div style={{display:'grid',gridTemplateColumns:`repeat(${months.length},1fr)`,gap:0}}>{months.map(m=><div key={m} style={{textAlign:'center'}}>{m}</div>)}</div>
      </div>
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:18}}>
        {members.map((m,mi)=>(
          <div key={m.id}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div className="avatar sm">{m.name[0]}</div>
              <b style={{fontSize:14}}>{m.name} <span style={{color:'var(--fg-muted)',fontWeight:500,fontSize:12}}>{m.position} · {m.dept}</span></b>
              <Pill tone={m.achieved?'success':'warning'}>{m.progress}%</Pill>
            </div>
            {MM.myTasks.slice(0,3+(mi%2)).map((t,ti)=>{
              const sm=parseInt(t.start.slice(5,7))-1+parseInt(t.start.slice(8,10))/30;
              const em=parseInt(t.end.slice(5,7))-1+parseInt(t.end.slice(8,10))/30;
              const left=sm/6*100, w=(em-sm)/6*100;
              const colors=['#F55000','#FFAA00','#D94400','#55474A'];
              return <div key={t.id+mi} style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14,alignItems:'center',padding:'4px 0'}}>
                <div style={{fontSize:12,color:'var(--fg-muted)',paddingLeft:36,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>T{String(ti+1).padStart(2,'0')} · {t.title}</div>
                <div style={{position:'relative',height:22,background:'var(--bg-muted)',borderRadius:5}}>
                  {months.map((_,i)=><div key={i} style={{position:'absolute',top:0,bottom:0,left:`${i*100/6}%`,width:1,background:'var(--border)'}}/>)}
                  <div style={{position:'absolute',top:2,bottom:2,left:`${left}%`,width:`${w}%`,background:colors[ti%4],borderRadius:3,opacity:0.85}}/>
                </div>
              </div>;
            })}
          </div>
        ))}
      </div>
    </div>
  </div>;
};

// ============================================================
// 7. 평가자 — 피드백 내역 (/feedback)
// ============================================================
const EvaluatorFeedbackPage = () => {
  const list = [
    {to:'이수한',title:'2026년 상반기 인사평가 체계 개선',score:4,date:'4/20',content:'체계 전환 과제를 주도적으로 이끌었고, 현업 인터뷰 20회 이상을 진행해 실행 가능한 정책으로 만들었습니다.'},
    {to:'주승현',title:'HR 데이터 대시보드 구축 지원',score:3,date:'4/18',content:'요구사항 정리가 깔끔했음. BI팀 리드의 피드백도 긍정적.'},
    {to:'김민선',title:'기여도 평가 시스템 사용자 온보딩',score:3,date:'4/5',content:'교육 프로그램의 구조는 좋았으나 평가자 그룹 대상 심화 세션이 부족했던 점 아쉬움.'},
  ];
  return <div style={{padding:24,display:'flex',flexDirection:'column',gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
      <div><h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>피드백 내역</h1><p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>내가 작성한 피드백 · 최근 3개월</p></div>
      <div style={{display:'flex',gap:6}}>
        <button className="btn btn-outline btn-sm">전체</button>
        <button className="btn btn-ghost btn-sm">이수한</button>
        <button className="btn btn-ghost btn-sm">주승현</button>
        <button className="btn btn-ghost btn-sm">김민선</button>
      </div>
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {list.map((f,i)=>(
        <div key={i} className="card" style={{padding:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div className="avatar sm">{f.to[0]}</div>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>→ {f.to}</div>
                <div style={{fontSize:11,color:'var(--fg-subtle)'}} className="tnum">{f.date}</div>
              </div>
              <Pill tone="neutral">{f.title}</Pill>
            </div>
            <NumBadge score={f.score} size={26}/>
          </div>
          <p style={{fontSize:13,lineHeight:1.65,margin:0}}>{f.content}</p>
          <div style={{display:'flex',gap:6,marginTop:12}}>
            <button className="btn btn-outline btn-xs">수정</button>
            <button className="btn btn-ghost btn-xs">이력 보기</button>
          </div>
        </div>
      ))}
    </div>
  </div>;
};

// ============================================================
// 8. HR — 부서별 진행 (/departments)
// ============================================================
const HrDepartmentsPage = () => (
  <div style={{padding:24,display:'flex',flexDirection:'column',gap:16}}>
    <div>
      <h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>부서별 진행 현황</h1>
      <p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>전사 6개 본부 · 기여도 평가 완료율</p>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14}}>
      {MM.hrStats.byDept.map(d=>(
        <div key={d.name} className="card-lg" style={{padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h4 style={{fontSize:15}}>{d.name}</h4>
            <Pill tone={d.rate>=80?'success':d.rate>=70?'orange':'warning'}>{d.rate}%</Pill>
          </div>
          <div style={{marginTop:16,display:'flex',alignItems:'baseline',gap:6}}>
            <span className="tnum" style={{fontSize:40,fontWeight:900,color:'var(--ok-orange)',lineHeight:1}}>{d.completed}</span>
            <span style={{color:'var(--fg-muted)',fontSize:14}} className="tnum">/ {d.total}</span>
            <span style={{color:'var(--fg-subtle)',fontSize:12,marginLeft:6}}>명 완료</span>
          </div>
          <div className="bar" style={{marginTop:12,height:8}}>
            <div className="fill" style={{width:d.rate+'%',background:d.rate>=80?'var(--success)':d.rate>=70?'var(--ok-orange)':'var(--ok-yellow)'}}/>
          </div>
          <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
            {[4,3,2,1].map(v=>{
              const col={4:'#F55000',3:'#D94400',2:'#FFAA00',1:'#C2BAB0'}[v];
              const h = [22,35,24,8][4-v];
              return <div key={v} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                <div style={{width:'100%',height:40,display:'flex',alignItems:'flex-end'}}>
                  <div style={{width:'100%',height:`${h*1.2}px`,background:col,borderRadius:3}}/>
                </div>
                <div style={{fontSize:10,color:'var(--fg-muted)',fontWeight:700}} className="tnum">{v}점 {h}%</div>
              </div>;
            })}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ============================================================
// 9. HR — 사용자 관리 (/users)
// ============================================================
const HrUsersPage = () => {
  const [q,setQ] = uS('');
  const filtered = MM.employees.filter(e=>!q||e.name.includes(q)||e.dept.includes(q));
  return <div style={{padding:24,display:'flex',flexDirection:'column',gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
      <div><h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>사용자 관리</h1><p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>{MM.employees.length}명 · 평가 권한 & 매핑 관리</p></div>
      <div style={{display:'flex',gap:6}}>
        <button className="btn btn-outline btn-sm">엑셀 업로드</button>
        <button className="btn btn-primary btn-sm"><I.plus width={14} height={14}/> 사용자 추가</button>
      </div>
    </div>

    <div style={{display:'flex',gap:10,alignItems:'center'}}>
      <div style={{position:'relative',flex:1,maxWidth:360}}>
        <div style={{position:'absolute',left:12,top:10,color:'var(--fg-subtle)'}}><I.search width={16} height={16}/></div>
        <input className="input" placeholder="이름·부서 검색" value={q} onChange={e=>setQ(e.target.value)} style={{paddingLeft:36}}/>
      </div>
      <button className="btn btn-ghost btn-sm">전체</button>
      <button className="btn btn-ghost btn-sm">평가자</button>
      <button className="btn btn-ghost btn-sm">피평가자</button>
      <button className="btn btn-ghost btn-sm">HR</button>
    </div>

    <div className="card-lg" style={{padding:0,overflow:'hidden'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead><tr style={{background:'var(--bg-muted)',fontSize:11,color:'var(--fg-muted)',textAlign:'left',letterSpacing:'0.06em'}}>
          <th style={{padding:'14px 20px',fontWeight:700}}>사번</th>
          <th style={{padding:'14px 10px',fontWeight:700}}>이름</th>
          <th style={{padding:'14px 10px',fontWeight:700}}>직급</th>
          <th style={{padding:'14px 10px',fontWeight:700}}>부서</th>
          <th style={{padding:'14px 10px',fontWeight:700,textAlign:'center'}}>레벨</th>
          <th style={{padding:'14px 10px',fontWeight:700}}>역할</th>
          <th style={{padding:'14px 10px',fontWeight:700}}>평가자</th>
          <th style={{padding:'14px 20px',fontWeight:700}}></th>
        </tr></thead>
        <tbody>
          {filtered.map(e=>{
            const roleTone={hr:'info',evaluator:'orange',evaluatee:'neutral'}[e.role];
            const roleLabel={hr:'HR',evaluator:'평가자',evaluatee:'피평가자'}[e.role];
            const evaluator = Object.entries(MM.evaluatorMap).find(([,list])=>list.includes(e.id))?.[0];
            const evName = evaluator ? MM.employees.find(x=>x.id===evaluator)?.name : '-';
            return <tr key={e.id} style={{borderTop:'1px solid var(--border)'}}>
              <td style={{padding:'12px 20px',fontFamily:'var(--font-mono)',fontSize:12,color:'var(--fg-muted)'}}>{e.id}</td>
              <td style={{padding:'12px 10px'}}><div style={{display:'flex',alignItems:'center',gap:8}}><div className="avatar sm">{e.name[0]}</div><b>{e.name}</b></div></td>
              <td style={{padding:'12px 10px'}}>{e.position}</td>
              <td style={{padding:'12px 10px',color:'var(--fg-muted)'}}>{e.dept}</td>
              <td style={{padding:'12px 10px',textAlign:'center'}}>{e.level?<Pill tone="neutral">Lv.{e.level}</Pill>:'-'}</td>
              <td style={{padding:'12px 10px'}}><Pill tone={roleTone}>{roleLabel}</Pill></td>
              <td style={{padding:'12px 10px',color:'var(--fg-muted)'}}>{evName}</td>
              <td style={{padding:'12px 20px',textAlign:'right'}}><button className="btn btn-ghost btn-xs">편집</button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
};

// ============================================================
// 10. HR — 시스템 설정 (/settings)
// ============================================================
const HrSettingsPage = () => (
  <div style={{padding:24,display:'flex',flexDirection:'column',gap:16,maxWidth:920}}>
    <div>
      <h1 style={{fontSize:26,fontWeight:900,letterSpacing:'-0.03em'}}>시스템 설정</h1>
      <p style={{color:'var(--fg-muted)',fontSize:13,marginTop:4}}>평가 기간·알림·권한·매트릭스 · 전사 공통 설정</p>
    </div>
    <div className="card-lg">
      <h4>평가 주기</h4>
      <div style={{marginTop:14,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
        <div className="field"><label>평가 주기</label><select className="input"><option>반기 (연 2회)</option><option>분기 (연 4회)</option><option>연 1회</option></select></div>
        <div className="field"><label>현재 라운드</label><input className="input" defaultValue="2026 상반기"/></div>
        <div className="field"><label>마감일</label><input className="input tnum" type="date" defaultValue="2026-04-30"/></div>
      </div>
    </div>
    <div className="card-lg">
      <h4>알림 설정</h4>
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:10}}>
        {[
          ['피드백이 작성되면 즉시 알림',true],
          ['평가가 완료되면 알림',true],
          ['과업 점수가 변경되면 알림',true],
          ['마감 3일 전 리마인드',true],
          ['주간 요약 이메일',false],
        ].map(([l,on])=>(
          <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'var(--bg-muted)',borderRadius:8}}>
            <span style={{fontSize:13}}>{l}</span>
            <div style={{width:42,height:24,borderRadius:999,background:on?'var(--ok-orange)':'var(--n-200)',position:'relative',cursor:'pointer',transition:'200ms'}}>
              <div style={{position:'absolute',top:2,left:on?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',boxShadow:'var(--sh-sm)',transition:'200ms'}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="card-lg">
      <h4>권한 & 역할</h4>
      <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {[
          {role:'HR',count:3,color:'var(--info)',perms:'시스템 설정 전체'},
          {role:'평가자',count:48,color:'var(--ok-orange)',perms:'팀원 평가·피드백 작성'},
          {role:'피평가자',count:291,color:'var(--n-400)',perms:'과업 등록·피드백 열람'},
        ].map(r=>(
          <div key={r.role} style={{padding:16,border:`2px solid ${r.color}`,borderRadius:10}}>
            <Pill tone="neutral">{r.role}</Pill>
            <div className="tnum" style={{fontSize:28,fontWeight:900,color:r.color,marginTop:8,lineHeight:1}}>{r.count}<span style={{fontSize:13,color:'var(--fg-muted)',fontWeight:600,marginLeft:4}}>명</span></div>
            <div style={{fontSize:11,color:'var(--fg-muted)',marginTop:8}}>{r.perms}</div>
          </div>
        ))}
      </div>
    </div>
    <div className="card-lg" style={{background:'var(--ok-orange-50)',border:'1px solid var(--ok-orange-100)'}}>
      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        <div style={{color:'var(--ok-orange)'}}><I.sparkle width={20} height={20}/></div>
        <div>
          <h4 style={{color:'var(--ok-brown)'}}>위험한 작업</h4>
          <p style={{fontSize:13,color:'var(--ok-brown)',lineHeight:1.6,marginTop:4}}>평가 라운드 초기화, 매트릭스 롤백, 전체 데이터 리셋은 복구할 수 없습니다.</p>
          <div style={{display:'flex',gap:6,marginTop:10}}>
            <button className="btn btn-outline btn-sm">라운드 아카이빙</button>
            <button className="btn btn-outline btn-sm" style={{borderColor:'var(--danger)',color:'var(--danger)'}}>전체 데이터 리셋</button>
          </div>
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, {
  NumBadge,
  MyTasksPage, MySchedulePage, MyFeedbackPage,
  TeamMembersPage, ScoreTablePage, EvaluatorSchedulePage, EvaluatorFeedbackPage,
  HrDepartmentsPage, HrUsersPage, HrSettingsPage,
});
