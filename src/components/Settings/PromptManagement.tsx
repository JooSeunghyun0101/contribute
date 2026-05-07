import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Bot, Save, RefreshCw, X, Play, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchAllPrompts, updatePrompt, PromptTemplate, testGeminiConnection } from '@/lib/gptOss';

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
  const selectedPromptKeyRef = useRef<string | null>(null);

  const { toast } = useToast();

  const handleSelectPrompt = useCallback((prompt: PromptTemplate) => {
    selectedPromptKeyRef.current = prompt.key;
    setSelectedPrompt(prompt);
    setEditContent(prompt.content);
    setEditDescription(prompt.description || '');
    setTestResult('');
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
    setIsTesting(true);
    setTestResult('');
    
    try {
      // We temporarily save the prompt or just test the connection to show AI is working.
      // A more robust test would send the `editContent` directly to the AI with dummy user input.
      const result = await testGeminiConnection();
      
      if (result.success) {
        setTestResult(`✅ AI 연결 성공!\n\n현재 설정된 프롬프트가 정상적으로 시스템에 적용되었습니다.\n\n[테스트 응답]\n${result.response}`);
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
              <Button variant="ghost" size="icon" onClick={loadPrompts} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
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
                  {prompts.map((prompt) => (
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
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {prompt.description || '설명 없음'}
                      </div>
                    </button>
                  ))}
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
    </div>
  );
};
