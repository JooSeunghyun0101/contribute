
import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Upload, Download, X, Check, AlertTriangle } from 'lucide-react';
import { ExcelRowData, ValidationError, EvaluatorMapping } from '@/types/evaluatorManagement';
import { readExcelFile, validateExcelData, generateTemplateFile, saveEvaluatorMappings, loadEvaluatorMappings } from '@/utils/excelUtils';
import { Plus } from 'lucide-react';

interface EvaluatorManagementProps {
  onClose: () => void;
}

export const EvaluatorManagement: React.FC<EvaluatorManagementProps> = ({ onClose }) => {
  const [uploadedData, setUploadedData] = useState<ExcelRowData[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [currentMappings, setCurrentMappings] = useState<EvaluatorMapping[]>(loadEvaluatorMappings());
  const { toast } = useToast();

  // State for inline editing in preview table
  const [editingPreviewRow, setEditingPreviewRow] = useState<number | null>(null);
  // State for inline editing in current mappings table
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/)) {
      toast({
        title: "파일 형식 오류",
        description: "Excel 파일(.xlsx, .xls)만 업로드 가능합니다.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const data = await readExcelFile(file);
      const errors = validateExcelData(data);
      
      setUploadedData(data);
      setValidationErrors(errors);
      
      if (errors.length === 0) {
        toast({
          title: "파일 업로드 성공",
          description: `${data.length}개의 매칭 데이터를 확인했습니다.`,
        });
      } else {
        toast({
          title: "데이터 검증 오류",
          description: `${errors.length}개의 오류가 발견되었습니다.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "파일 업로드 실패",
        description: "파일을 읽는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const downloadTemplate = () => {
    try {
      const template = generateTemplateFile();
      const blob = new Blob([template], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '평가자매칭_템플릿.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "템플릿 다운로드 실패",
        description: "템플릿 파일을 생성할 수 없습니다.",
        variant: "destructive",
      });
    }
  };

  const confirmMappings = () => {
    if (validationErrors.length > 0) {
      toast({
        title: "데이터 오류",
        description: "모든 오류를 수정한 후 다시 시도해주세요.",
        variant: "destructive",
      });
      return;
    }

    // 기존 매핑과 중복되는 항목은 제외
    const existingSet = new Set(
      currentMappings.map(
        m => `${m.evaluatorName}|${m.evaluateeName}|${m.evaluationPeriod}`
      )
    );

    const newMappings: EvaluatorMapping[] = uploadedData
      .filter(row => {
        const key = `${row.evaluatorName}|${row.evaluateeName}|${row.evaluationPeriod || '2024년 하반기'}`;
        return !existingSet.has(key);
      })
      .map((row, index) => ({
        id: `mapping-${Date.now()}-${index}`,
        evaluatorName: row.evaluatorName,
        evaluatorDepartment: row.evaluatorDepartment,
        evaluatorPosition: row.evaluatorPosition,
        evaluateeName: row.evaluateeName,
        evaluateeDepartment: row.evaluateeDepartment,
        evaluateePosition: row.evaluateePosition,
        evaluationPeriod: row.evaluationPeriod || '2024년 하반기',
        status: 'active',
        createdAt: new Date().toISOString()
      }));

    const updatedMappings = [...currentMappings, ...newMappings];
    setCurrentMappings(updatedMappings);
    saveEvaluatorMappings(updatedMappings);
    
    toast({
      title: "매칭 정보 저장 완료",
      description: `${newMappings.length}개의 새로운 평가자-피평가자 매칭이 저장되었습니다.`,
    });

    setUploadedData([]);
    setValidationErrors([]);
  };

  const removeMapping = (id: string) => {
    const updatedMappings = currentMappings.filter(m => m.id !== id);
    setCurrentMappings(updatedMappings);
    saveEvaluatorMappings(updatedMappings);
    
    toast({
      title: "매칭 삭제 완료",
      description: "선택한 매칭 정보가 삭제되었습니다.",
    });
  };

  // Handle inline edit in preview table
  const handlePreviewChange = (index: number, field: keyof ExcelRowData, value: string) => {
    const newData = [...uploadedData];
    newData[index] = { ...newData[index], [field]: value };
    setUploadedData(newData);
    // Re-validate all data to update errors
    setValidationErrors(validateExcelData(newData));
  };

  // Handle inline edit in current mappings table
  const handleMappingChange = (id: string, field: keyof EvaluatorMapping, value: string) => {
    const newData = currentMappings.map(m => m.id === id ? { ...m, [field]: value } : m);
    setCurrentMappings(newData);
  };

  const saveEditedMapping = () => {
    saveEvaluatorMappings(currentMappings);
    setEditingMappingId(null);
    toast({
      title: "매칭 수정 완료",
      description: "매칭 정보가 성공적으로 수정되었습니다.",
    });
  };

  const addNewMappingRow = () => {
    const newMapping: EvaluatorMapping = {
      id: `mapping-${Date.now()}`,
      evaluatorName: '',
      evaluatorDepartment: '',
      evaluatorPosition: '',
      evaluateeName: '',
      evaluateeDepartment: '',
      evaluateePosition: '',
      evaluationPeriod: '2024년 하반기',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    setCurrentMappings([newMapping, ...currentMappings]);
    setEditingMappingId(newMapping.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">평가자 관리</h2>
          <p className="text-muted-foreground">엑셀 파일로 평가자-피평가자 매칭을 관리하세요</p>
        </div>
        <Button variant="outline" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          닫기
        </Button>
      </div>

      {/* Template Download */}
      <Card>
        <CardHeader>
          <CardTitle>템플릿 다운로드</CardTitle>
          <CardDescription>표준 양식을 다운로드하여 데이터를 입력해주세요</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={downloadTemplate} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            템플릿 다운로드
          </Button>
        </CardContent>
      </Card>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle>파일 업로드</CardTitle>
          <CardDescription>엑셀 파일을 드래그하거나 클릭하여 업로드하세요</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/40 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">파일을 드래그하거나 클릭하여 업로드</p>
            <p className="text-sm text-muted-foreground mb-4">Excel 파일(.xlsx, .xls)만 지원</p>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileInputChange}
              className="max-w-xs mx-auto"
              disabled={isUploading}
            />
          </div>
        </CardContent>
      </Card>

      {/* Data Preview and Validation */}
      {uploadedData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              업로드된 데이터 미리보기
              {validationErrors.length > 0 && (
                <Badge variant="destructive">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {validationErrors.length}개 오류
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              데이터를 확인하고 오류가 없으면 저장버튼을 클릭하세요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>행</TableHead>
                    <TableHead>평가자</TableHead>
                    <TableHead>평가자 부서</TableHead>
                    <TableHead>피평가자</TableHead>
                    <TableHead>피평가자 부서</TableHead>
                    <TableHead>평가기간</TableHead>
                    <TableHead>상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadedData.map((row, index) => {
                    const rowErrors = validationErrors.filter(err => err.row === index + 2);
                    const hasError = rowErrors.length > 0;
                    const isEditing = editingPreviewRow === index;
                    
                    return (
                      <TableRow key={index} className={hasError ? 'bg-destructive/10' : ''}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell onDoubleClick={() => setEditingPreviewRow(index)}>
                          {isEditing ? (
                            <Input value={row.evaluatorName} onChange={e => handlePreviewChange(index, 'evaluatorName', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : row.evaluatorName}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingPreviewRow(index)}>
                          {isEditing ? (
                            <Input value={row.evaluatorDepartment} onChange={e => handlePreviewChange(index, 'evaluatorDepartment', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : row.evaluatorDepartment}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingPreviewRow(index)}>
                          {isEditing ? (
                            <Input value={row.evaluateeName} onChange={e => handlePreviewChange(index, 'evaluateeName', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : row.evaluateeName}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingPreviewRow(index)}>
                          {isEditing ? (
                            <Input value={row.evaluateeDepartment} onChange={e => handlePreviewChange(index, 'evaluateeDepartment', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : row.evaluateeDepartment}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingPreviewRow(index)}>
                          {isEditing ? (
                            <Input value={row.evaluationPeriod || ''} onChange={e => handlePreviewChange(index, 'evaluationPeriod', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : row.evaluationPeriod}
                        </TableCell>
                        <TableCell>
                          {hasError ? (
                            <Badge variant="destructive">오류</Badge>
                          ) : (
                            <Badge variant="default">정상</Badge>
                          )}
                        </TableCell>
                        {isEditing && (
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setEditingPreviewRow(null)}>완료</Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {validationErrors.length > 0 && (
              <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-md">
                <h4 className="font-medium text-destructive mb-2">검증 오류 목록:</h4>
                <ul className="text-sm text-destructive/80 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>
                      {error.row}행 {error.field}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <Button 
                onClick={confirmMappings}
                disabled={validationErrors.length > 0}
                className="flex items-center gap-2"
              >
                <Check className="h-4 w-4" />
                매칭 정보 저장
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Mappings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>현재 매칭 현황</CardTitle>
            <CardDescription>저장된 평가자-피평가자 매칭 정보</CardDescription>
          </div>
          <Button onClick={addNewMappingRow} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            수동 매칭 추가
          </Button>
        </CardHeader>
        <CardContent>
          {currentMappings.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              등록된 매칭 정보가 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>평가자</TableHead>
                    <TableHead>평가자 부서</TableHead>
                    <TableHead>피평가자</TableHead>
                    <TableHead>피평가자 부서</TableHead>
                    <TableHead>평가기간</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentMappings.map((mapping) => {
                    const isEditing = editingMappingId === mapping.id;
                    return (
                      <TableRow key={mapping.id}>
                        <TableCell className="font-medium" onDoubleClick={() => setEditingMappingId(mapping.id)}>
                          {isEditing ? (
                            <Input value={mapping.evaluatorName} onChange={e => handleMappingChange(mapping.id, 'evaluatorName', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : mapping.evaluatorName}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingMappingId(mapping.id)}>
                          {isEditing ? (
                            <Input value={mapping.evaluatorDepartment} onChange={e => handleMappingChange(mapping.id, 'evaluatorDepartment', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : mapping.evaluatorDepartment}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingMappingId(mapping.id)}>
                          {isEditing ? (
                            <Input value={mapping.evaluateeName} onChange={e => handleMappingChange(mapping.id, 'evaluateeName', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : mapping.evaluateeName}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingMappingId(mapping.id)}>
                          {isEditing ? (
                            <Input value={mapping.evaluateeDepartment} onChange={e => handleMappingChange(mapping.id, 'evaluateeDepartment', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : mapping.evaluateeDepartment}
                        </TableCell>
                        <TableCell onDoubleClick={() => setEditingMappingId(mapping.id)}>
                          {isEditing ? (
                            <Input value={mapping.evaluationPeriod} onChange={e => handleMappingChange(mapping.id, 'evaluationPeriod', e.target.value)} className="h-8 max-w-[120px]" />
                          ) : mapping.evaluationPeriod}
                        </TableCell>
                        <TableCell>
                          <Badge variant={mapping.status === 'active' ? 'default' : 'secondary'}>
                            {mapping.status === 'active' ? '활성' : '비활성'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {isEditing ? (
                              <Button variant="default" size="sm" onClick={saveEditedMapping}>저장</Button>
                            ) : null}
                            <Button
                              variant="outline" 
                              size="sm"
                              onClick={() => removeMapping(mapping.id)}
                            >
                              삭제
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
