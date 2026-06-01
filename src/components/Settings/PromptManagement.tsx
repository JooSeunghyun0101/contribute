import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Bot, Save, RefreshCw, X, Play, Loader2, Plus, Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  fetchAllPrompts,
  updatePrompt,
  createPrompt,
  deletePrompt,
  PromptTemplate,
  testPromptDraft,
} from '@/lib/gptOss';

// prompt key → 실제 사용되는 화면/기능 매핑.
// 새 AI 기능을 추가하면 여기에도 같이 등록해 HR이 어디 영향이 가는지 알 수 있게 한다.
const PROMPT_USAGE: Record<string, { screen: string; route?: string }[]> = {
  evaluation_guide: [{ screen: '공통 평가 기준 (다른 프롬프트에 합성)' }],
  feedback_recommendation: [{ screen: '평가 화면 · 평가자 피드백 의견 AI 작성', route: '/evaluation/:id' }],
  performance_report_draft: [{ screen: '피평가자 과업 입력 · 성과보고 AI 작성', route: '/my' }],
  feedback_improvement: [{ screen: '평가 화면 · 피드백 문장 교정', route: '/evaluation/:id' }],
  ai_feedback_chat: [{ screen: '평가 화면 · AI 대화형 도우미', route: '/evaluation/:id' }],
  feedback_generic_review: [{ screen: '평가 저장 · 피드백 일반성 검수', route: '/evaluation/:id' }],
  feedback_similarity_review: [{ screen: '평가 저장 · 피드백 유사도 검수', route: '/evaluation/:id' }],
  evaluation_feedback_review: [{ screen: '평가 저장 · 변경 피드백 일괄 검수', route: '/evaluation/:id' }],
  ai_connection_test: [{ screen: '시스템 · AI 연결 테스트' }],
  evaluator_qna_assistant: [{ screen: '평가자 AI 도움말', route: '/team/ai' }],
  growth_suggestion: [{ screen: '피평가자 대시보드 · AI 성장 제안', route: '/my' }],
  feedback_summary_evaluatee: [{ screen: '피평가자 피드백 이력 · AI 요약', route: '/my/feedback' }],
  feedback_summary_evaluator: [{ screen: '평가자 피드백 내역 · AI 요약', route: '/team/feedback' }],
};

interface PromptManagementProps {
  onClose?: () => void;
  showClose?: boolean;
}

export const PromptManagement: React.FC<PromptManagementProps> = ({ onClose, showClose = true }) => {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptTemplate | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editDescription, setEditDescription] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Test functionality
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const [testInput, setTestInput] = useState<string>('');
  const selectedPromptKeyRef = useRef<string | null>(null);

  // 새 프롬프트 추가 모달
  const [showNewModal, setShowNewModal] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newContent, setNewContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // 삭제 진행 상태
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast } = useToast();

  const handleSelectPrompt = useCallback((prompt: PromptTemplate) => {
    selectedPromptKeyRef.current = prompt.key;
    setSelectedPrompt(prompt);
    setEditContent(prompt.content);
    setEditDescription(prompt.description || '');
    setTestResult('');
    setTestInput('');
  }, []);

  const loadPrompts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchAllPrompts();
      setPrompts(data);
      const currentKey = selectedPromptKeyRef.current;
      if (data.length > 0 && !currentKey) {
        handleSelectPrompt(data[0]);
      } else if (currentKey) {
        // Update selected prompt data if it was refreshed
        const updatedSelected = data.find(p => p.key === currentKey);
        if (updatedSelected) {
          handleSelectPrompt(updatedSelected);
        }
      }
    } catch (error) {
      console.error('Failed to load prompts:', error);
      toast({
        title: "오류 발생",
        description: "프롬프트 목록을 불러오지 못했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [handleSelectPrompt, toast]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleSave = async () => {
    if (!selectedPrompt) return;
    
    if (!editContent.trim()) {
      toast({
        title: "입력 오류",
        description: "프롬프트 내용을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      await updatePrompt(selectedPrompt.key, editContent, editDescription);
      toast({
        title: "저장 완료",
        description: "프롬프트가 성공적으로 업데이트되었습니다.",
      });
      await loadPrompts(); // Refresh the list
    } catch (error) {
      console.error('Failed to save prompt:', error);
      toast({
        title: "저장 실패",
        description: "프롬프트 업데이트 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!editContent.trim()) {
      toast({
        title: '프롬프트가 비어 있습니다.',
        description: '테스트할 프롬프트 내용을 먼저 입력해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    setIsTesting(true);
    setTestResult('');

    try {
      const result = await testPromptDraft(editContent, testInput);

      if (result.success) {
        setTestResult(
          `✅ 응답 수신\n\n작성 중인 프롬프트(저장 전)와 아래 테스트 입력으로 호출한 결과입니다.\n\n[테스트 입력]\n${
            testInput.trim() || '(기본 입력)'
          }\n\n[AI 응답]\n${result.response}`,
        );
      } else {
        setTestResult(`❌ 테스트 실패\n\n오류 내용: ${result.error}`);
      }
    } catch (error) {
      setTestResult(`❌ 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsTesting(false);
    }
  };

  const hasChanges = selectedPrompt && (
    selectedPrompt.content !== editContent ||
    (selectedPrompt.description || '') !== editDescription
  );

  const openNewModal = () => {
    setNewKey('');
    setNewDescription('');
    setNewContent('');
    setShowNewModal(true);
  };

  // 키 검증: 영문 소문자/숫자/언더스코어만, 영문으로 시작, 64자 이하, 중복 금지
  const newKeyTrimmed = newKey.trim();
  const newKeyValid = /^[a-z][a-z0-9_]{2,63}$/.test(newKeyTrimmed);
  const newKeyDuplicate = prompts.some((p) => p.key === newKeyTrimmed);
  const canCreate = newKeyValid && !newKeyDuplicate && newContent.trim().length > 0;

  const handleCreateNew = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    try {
      const created = await createPrompt(newKeyTrimmed, newContent, newDescription.trim() || undefined);
      toast({ title: '새 프롬프트가 추가되었습니다.', description: created.key });
      setShowNewModal(false);
      await loadPrompts();
      // 새로 만든 항목을 자동 선택
      selectedPromptKeyRef.current = created.key;
    } catch (error) {
      console.error('Failed to create prompt:', error);
      toast({
        title: '추가 실패',
        description: error instanceof Error ? error.message : '프롬프트를 추가하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPrompt) return;
    const ok = window.confirm(
      `프롬프트 "${selectedPrompt.key}" 를 삭제할까요?\n\n이 프롬프트를 사용하는 화면이 있다면 기본값으로 동작합니다.`,
    );
    if (!ok) return;
    setIsDeleting(true);
    try {
      await deletePrompt(selectedPrompt.key);
      toast({ title: '프롬프트가 삭제되었습니다.', description: selectedPrompt.key });
      selectedPromptKeyRef.current = null;
      setSelectedPrompt(null);
      setEditContent('');
      setEditDescription('');
      await loadPrompts();
    } catch (error) {
      console.error('Failed to delete prompt:', error);
      toast({
        title: '삭제 실패',
        description: error instanceof Error ? error.message : '프롬프트를 삭제하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            AI 프롬프트 관리
          </h2>
          <p className="text-muted-foreground">시스템 기능에 사용되는 AI 프롬프트를 통합 관리합니다</p>
        </div>
        {showClose && onClose && (
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            닫기
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Side: Prompt List */}
        <Card className="col-span-1 h-[600px] flex flex-col">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">프롬프트 목록</CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={openNewModal} title="새 프롬프트 추가">
                  <Plus className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={loadPrompts} disabled={isLoading} title="새로고침">
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden">
            <ScrollArea className="h-full">
              {isLoading && prompts.length === 0 ? (
                <div className="flex justify-center items-center h-40">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : prompts.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  등록된 프롬프트가 없습니다.
                </div>
              ) : (
                <div className="flex flex-col p-2 space-y-1">
                  {prompts.map((prompt) => {
                    const usages = PROMPT_USAGE[prompt.key] ?? [];
                    return (
                      <button
                        key={prompt.key}
                        onClick={() => handleSelectPrompt(prompt)}
                        className={`text-left p-3 rounded-md transition-colors ${
                          selectedPrompt?.key === prompt.key
                            ? 'bg-primary/10 border border-primary/20'
                            : 'hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        <div className="font-medium text-sm mb-1">{prompt.key}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {prompt.description || '설명 없음'}
                        </div>
                        {usages.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {usages.map((u, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary"
                              >
                                {u.screen}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right Side: Prompt Editor */}
        <Card className="col-span-1 md:col-span-2 h-[600px] flex flex-col">
          {selectedPrompt ? (
            <>
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {selectedPrompt.key}
                      {hasChanges && <Badge variant="secondary" className="ml-2">수정됨</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      마지막 수정: {selectedPrompt.updated_at ? new Date(selectedPrompt.updated_at).toLocaleString() : '정보 없음'}
                    </CardDescription>
                    {(PROMPT_USAGE[selectedPrompt.key] ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(PROMPT_USAGE[selectedPrompt.key] ?? []).map((u, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary"
                            title={u.route ? `라우트: ${u.route}` : undefined}
                          >
                            {u.screen}
                            {u.route && (
                              <span className="text-[10px] opacity-70 ml-1">
                                {u.route}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTest}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4 text-emerald-500" />
                      )}
                      테스트
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={!hasChanges || isSaving}
                    >
                      {isSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      저장
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {isDeleting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      삭제
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">설명 (어떤 상황에서 쓰이는 프롬프트인지 기재)</Label>
                  <Input 
                    id="description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="프롬프트에 대한 설명을 입력하세요..."
                  />
                </div>
                
                <div className="space-y-2 flex-1 flex flex-col">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="content">시스템 프롬프트 (System Instruction)</Label>
                  </div>
                  <Textarea
                    id="content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="flex-1 font-mono text-sm resize-none min-h-[300px]"
                    placeholder="AI에게 지시할 프롬프트 내용을 입력하세요..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="test-input">테스트 입력 (선택)</Label>
                  <Textarea
                    id="test-input"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    className="font-sans text-sm resize-y min-h-[64px]"
                    placeholder="저장 전에 이 프롬프트가 어떻게 동작하는지 확인하기 위한 더미 입력입니다. 비워두면 기본 입력으로 테스트합니다."
                  />
                  <p className="text-xs text-muted-foreground">
                    저장 없이 작성 중인 프롬프트를 그대로 AI에 보내고 응답을 확인합니다.
                  </p>
                </div>

                {testResult && (
                  <div className="mt-4 p-4 rounded-md bg-muted/50 border border-border">
                    <h4 className="font-medium flex items-center gap-2 mb-2 text-sm">
                      <Bot className="h-4 w-4" /> 테스트 결과
                    </h4>
                    <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground bg-background p-3 rounded border">
                      {testResult}
                    </pre>
                  </div>
                )}
              </CardContent>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
              <Bot className="h-12 w-12 mb-4 opacity-20" />
              <p>좌측에서 관리할 프롬프트를 선택해주세요.</p>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={showNewModal} onOpenChange={(open) => !isCreating && setShowNewModal(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>새 프롬프트 추가</DialogTitle>
            <DialogDescription>
              새로운 AI 프롬프트 템플릿을 등록합니다. 키는 영문 소문자·숫자·언더스코어만 사용하세요(예: <code>my_new_prompt</code>).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="new-key">키 *</Label>
              <Input
                id="new-key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="my_new_prompt"
                disabled={isCreating}
              />
              {newKeyTrimmed && !newKeyValid && (
                <p className="text-xs text-destructive">
                  영문 소문자로 시작하고 3~64자, 영문·숫자·언더스코어(_)만 사용 가능합니다.
                </p>
              )}
              {newKeyValid && newKeyDuplicate && (
                <p className="text-xs text-destructive">이미 사용 중인 키입니다.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-description">설명</Label>
              <Input
                id="new-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="이 프롬프트가 어떤 상황에서 쓰이는지"
                disabled={isCreating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-content">시스템 프롬프트 *</Label>
              <Textarea
                id="new-content"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="font-mono text-sm min-h-[180px]"
                placeholder="AI 에게 지시할 프롬프트 내용을 입력하세요…"
                disabled={isCreating}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewModal(false)} disabled={isCreating}>
              취소
            </Button>
            <Button onClick={handleCreateNew} disabled={!canCreate || isCreating}>
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
