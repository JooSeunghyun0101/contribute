"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useOnClickOutside } from "usehooks-ts"
import { MessageSquare, Target, TrendingUp, Users, Calendar as CalendarIcon, Edit2, Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import type { Task, FeedbackHistoryItem } from "@/types/evaluation"
import { getContributionTooltip } from "@/utils/evaluationUtils"
import ScoringChart from "@/components/ScoringChart"

interface TaskListingComponentProps {
  tasks: Task[]
  className?: string
  onSaveTask?: (task: Task) => Promise<void>
}

function TaskIcon({ weight }: { weight: number }) {
  const color =
    weight >= 40 ? "#b45309" : weight >= 20 ? "#ca8a04" : "#78716c"
  return (
    <div
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border bg-muted"
      style={{ color }}
    >
      <Target className="h-5 w-5" />
    </div>
  )
}

export default function TaskListingComponent({
  tasks,
  className,
  onSaveTask
}: TaskListingComponentProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Task>>({})
  const [isSaving, setIsSaving] = useState(false)

  const ref = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>
  
  useOnClickOutside(ref, () => {
    if (!isEditing) {
      setActiveTask(null)
    }
  })

  useEffect(() => {
    function onKeyDown(event: { key: string }) {
      if (event.key === "Escape" && !isEditing) {
        setActiveTask(null)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isEditing])

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeTask) {
      setEditForm({ ...activeTask });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
    setEditForm({});
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSaveTask || !activeTask) return;
    
    setIsSaving(true);
    try {
      const updatedTask = { ...activeTask, ...editForm } as Task;
      await onSaveTask(updatedTask);
      setActiveTask(updatedTask);
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save task", error);
    } finally {
      setIsSaving(false);
    }
  };

  if (tasks.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        아직 과업이 없습니다.
      </p>
    )
  }

  return (
    <>
      {/* 블러 오버레이 */}
      <AnimatePresence>
        {activeTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 backdrop-blur-sm bg-background/40"
          />
        )}
      </AnimatePresence>

      {/* 확장된 카드 */}
      <AnimatePresence>
        {activeTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none">
            <motion.div
              ref={ref}
              layoutId={`task-${activeTask.id}`}
              className="bg-background flex w-full max-w-2xl cursor-auto flex-col gap-4 border border-border p-5 shadow-lg pointer-events-auto"
              style={{ borderRadius: 12, maxHeight: '85vh' }}
            >
              {/* 헤더 */}
              <div className="flex w-full items-start gap-4 flex-shrink-0">
                <motion.div layoutId={`task-icon-${activeTask.id}`}>
                  <TaskIcon weight={activeTask.weight} />
                </motion.div>
                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isEditing ? (
                      <div className="w-full flex items-center gap-2 mb-2">
                        <Input
                          value={editForm.title || ""}
                          onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="과업명을 입력하세요"
                          className="font-semibold text-base h-8"
                        />
                        <div className="flex items-center gap-2 w-32 shrink-0">
                          <Label className="text-xs shrink-0">비중</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={editForm.weight || 0}
                            onChange={(e) => setEditForm(prev => ({ ...prev, weight: parseInt(e.target.value) || 0 }))}
                            className="h-8 text-xs px-2"
                          />
                          <span className="text-xs">%</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <motion.div
                          layoutId={`task-title-${activeTask.id}`}
                          className="font-semibold text-foreground text-base break-words"
                        >
                          {activeTask.title}
                        </motion.div>
                      </>
                    )}
                  </div>

                  <motion.div
                    layoutId={`task-meta-${activeTask.id}`}
                    className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1"
                  >
                    {isEditing ? (
                      <div className="flex gap-2 w-full mt-2">
                         <div className="flex-1">
                          <Label className="text-xs mb-1 block">시작일</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal text-xs h-8 px-2",
                                  !editForm.startDate && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-1 h-3 w-3" />
                                {editForm.startDate ? format(new Date(editForm.startDate), 'yyyy-MM-dd') : '시작일'}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 z-50 pointer-events-auto" align="start">
                              <Calendar
                                mode="single"
                                selected={editForm.startDate ? new Date(editForm.startDate) : undefined}
                                onSelect={(date) => setEditForm(prev => ({ ...prev, startDate: date ? format(date, 'yyyy-MM-dd') : undefined }))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs mb-1 block">종료일</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal text-xs h-8 px-2",
                                  !editForm.endDate && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-1 h-3 w-3" />
                                {editForm.endDate ? format(new Date(editForm.endDate), 'yyyy-MM-dd') : '종료일'}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 z-50 pointer-events-auto" align="start">
                              <Calendar
                                mode="single"
                                selected={editForm.endDate ? new Date(editForm.endDate) : undefined}
                                onSelect={(date) => setEditForm(prev => ({ ...prev, endDate: date ? format(date, 'yyyy-MM-dd') : undefined }))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    ) : (
                      <>
                        {activeTask.startDate && activeTask.endDate && (
                          <span className="flex items-center gap-1 flex-shrink-0">
                            <CalendarIcon className="h-3 w-3" />
                            {activeTask.startDate.substring(0, 10)} ~ {activeTask.endDate.substring(0, 10)}
                          </span>
                        )}
                        <span className="flex items-center gap-1 font-semibold text-muted-foreground flex-shrink-0">
                          비중 {activeTask.weight}%
                        </span>
                      </>
                    )}
                  </motion.div>
                </div>

                {/* 점수 또는 수정 모드 액션 버튼 */}
                <div className="flex flex-col items-end flex-shrink-0 gap-2">
                   {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <Button 
                          size="sm" 
                          onClick={handleSaveEdit} 
                          disabled={isSaving}
                          className="h-8 text-xs w-[70px]"
                        >
                          <Check className="h-3 w-3 mr-1" />
                          저장
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                          className="h-8 text-xs w-[70px]"
                        >
                          <X className="h-3 w-3 mr-1" />
                          취소
                        </Button>
                      </div>
                   ) : (
                     <>
                        {onSaveTask && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleEditClick}
                            className="h-8 text-xs w-full mb-1"
                          >
                            <Edit2 className="h-3 w-3 mr-1" />
                            과업 수정
                          </Button>
                        )}
                        {activeTask.score !== undefined && (
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-3xl font-extrabold text-primary leading-none">
                              {activeTask.score}점
                            </span>
                            <span className="text-sm font-bold text-amber-500">
                              비중점수 {((activeTask.score * activeTask.weight) / 100).toFixed(2)}
                            </span>
                          </div>
                        )}
                     </>
                   )}
                </div>
              </div>

              {/* 설명 */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-2 custom-scrollbar">
                {isEditing ? (
                   <div className="w-full space-y-2 mt-2">
                      <Label className="text-sm">과업 설명</Label>
                      <Textarea
                        value={editForm.description || ""}
                        onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="과업 설명을 입력하세요"
                        rows={4}
                        className="text-sm w-full"
                      />
                   </div>
                ) : (
                  <motion.p
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.05 } }}
                    className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words"
                  >
                    {activeTask.description || "과업 설명이 없습니다."}
                  </motion.p>
                )}
              </div>

              <div className="flex flex-col md:flex-row gap-4 w-full items-start flex-shrink-0">
                {/* 스코어링 매트릭스 */}
                {!isEditing && (
                  <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.05 } }}
                    className="flex-shrink-0"
                  >
                    <ScoringChart
                      selectedMethod={activeTask.contributionMethod}
                      selectedScope={activeTask.contributionScope}
                      isReadOnly={true}
                      size="small"
                    />
                  </motion.div>
                )}

                {/* 피드백 */}
                <motion.div
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.05 } }}
                  className="flex-1 min-w-0"
                >
                {(() => {
                  let finalFeedback: string | null = null
                  let feedbackDate: string | null = null
                  let evaluatorName: string | null = null

                  if (activeTask.feedbackHistory && activeTask.feedbackHistory.length > 0) {
                    const sorted = [...activeTask.feedbackHistory].sort(
                      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
                    )
                    finalFeedback = sorted[0].content
                    feedbackDate = sorted[0].date
                    evaluatorName = sorted[0].evaluatorName
                  } else if (activeTask.feedback) {
                    finalFeedback = activeTask.feedback
                    feedbackDate = activeTask.feedbackDate || activeTask.lastModified || null
                    evaluatorName = activeTask.evaluatorName || "평가자"
                  }

                  if (finalFeedback) {
                    return (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium text-primary">최종 피드백</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {evaluatorName && <span>평가자: {evaluatorName}</span>}
                            {feedbackDate && (
                              <span>
                                {new Date(feedbackDate).toLocaleDateString("ko-KR", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed break-words">
                          {finalFeedback}
                        </p>
                        {activeTask.feedbackHistory && activeTask.feedbackHistory.length > 1 && (
                          <p className="mt-2 text-xs text-primary">
                            총 {activeTask.feedbackHistory.length}개의 피드백 이력이 있습니다.
                          </p>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          아직 받은 피드백이 없습니다.
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </motion.div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 과업 목록 */}
      <div className={`relative flex items-start ${className || ""}`}>
        <div className="relative flex w-full flex-col gap-3">
          {tasks.map((task) => {
            const weightedScore =
              task.score !== undefined
                ? ((task.score * task.weight) / 100).toFixed(2)
                : null

            return (
              <motion.div
                layoutId={`task-${task.id}`}
                key={task.id}
                className="group bg-background flex w-full cursor-pointer flex-row items-center gap-4 border border-border p-3 shadow-sm hover:border-primary/40 hover:shadow-md transition-shadow md:p-4"
                onClick={() => setActiveTask(task)}
                style={{ borderRadius: 8 }}
              >
                <motion.div layoutId={`task-icon-${task.id}`}>
                  <TaskIcon weight={task.weight} />
                </motion.div>

                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <motion.div
                      layoutId={`task-title-${task.id}`}
                      className="font-semibold text-foreground text-sm truncate"
                    >
                      {task.title}
                    </motion.div>
                  </div>

                  <motion.div
                    layoutId={`task-meta-${task.id}`}
                    className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
                  >
                    {task.startDate && task.endDate && (
                      <span className="flex items-center gap-1 flex-shrink-0">
                        <CalendarIcon className="h-3 w-3" />
                        {task.startDate.substring(0, 10)} ~ {task.endDate.substring(0, 10)}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-semibold text-muted-foreground flex-shrink-0">
                      비중 {task.weight}%
                    </span>
                  </motion.div>
                </div>

                {/* 점수 (우측) */}
                <div className="flex items-baseline gap-2 flex-shrink-0">
                  {task.score !== undefined ? (
                    <>
                      <span className="text-xl font-extrabold text-primary leading-none">
                        {task.score}점
                      </span>
                      {weightedScore && (
                        <span className="text-sm font-bold text-amber-500">
                          비중점수 {weightedScore}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">미완료</span>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </>
  )
}
