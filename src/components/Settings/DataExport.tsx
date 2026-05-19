import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Download, FileText, GitBranch, Users, X } from 'lucide-react';
import {
  downloadEmployeeProfileUploadWorkbook,
  downloadFullEvaluationDataWorkbook,
  downloadHrBackupWorkbook,
  downloadMatchingUploadWorkbook,
} from '@/utils/hrDataExport';

interface DataExportProps {
  onClose: () => void;
}

type ExportKind = 'profile' | 'matching' | 'evaluations' | 'backup';

export const DataExport: React.FC<DataExportProps> = ({ onClose }) => {
  const { toast } = useToast();
  const [includePastEvaluations, setIncludePastEvaluations] = useState(true);
  const [exportingKind, setExportingKind] = useState<ExportKind | null>(null);

  const runExport = async (
    kind: ExportKind,
    exporter: () => Promise<any>,
    buildDescription: (result: any) => string,
  ) => {
    setExportingKind(kind);
    try {
      const result = await exporter();
      toast({
        title: '데이터 내보내기 완료',
        description: buildDescription(result),
      });
    } catch (error) {
      console.error('데이터 내보내기 실패:', error);
      toast({
        title: '내보내기 실패',
        description: 'Excel 파일을 생성하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setExportingKind(null);
    }
  };

  const isExporting = exportingKind !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">데이터 내보내기</h2>
          <p className="text-muted-foreground">
            대상자·매칭은 업로드 양식 그대로, 평가는 이전 평가까지 포함해 내려받습니다.
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          닫기
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            평가 데이터 범위
          </CardTitle>
          <CardDescription>평가 데이터 파일과 전체 백업 파일에 적용됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="includePastEvaluations"
              checked={includePastEvaluations}
              onCheckedChange={(checked) => setIncludePastEvaluations(Boolean(checked))}
            />
            <label htmlFor="includePastEvaluations" className="text-sm font-medium leading-none">
              이전 평가와 이전 평가자 입력 내역까지 포함
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              대상자 업로드 양식
            </CardTitle>
            <CardDescription>현재 대상자를 대상자 업로드 파일과 같은 시트/컬럼으로 받습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                runExport(
                  'profile',
                  downloadEmployeeProfileUploadWorkbook,
                  (result) => `${result.targetCount ?? 0}명의 현재 대상자를 내보냈습니다.`,
                )
              }
              className="w-full"
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportingKind === 'profile' ? '내보내는 중...' : '대상자 다운로드'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              매칭 업로드 양식
            </CardTitle>
            <CardDescription>현재 매칭과 이전 평가자 이력을 개인별 매칭결과 양식으로 받습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                runExport(
                  'matching',
                  downloadMatchingUploadWorkbook,
                  (result) => `${result.rowCount ?? 0}건의 매칭 이력을 내보냈습니다.`,
                )
              }
              className="w-full"
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportingKind === 'matching' ? '내보내는 중...' : '매칭 다운로드'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              전체 평가 데이터
            </CardTitle>
            <CardDescription>성과보고내용, 평가결과, 평가자별 입력, 피드백, 점수를 모두 받습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                runExport(
                  'evaluations',
                  () => downloadFullEvaluationDataWorkbook({ includePastEvaluations }),
                  (result) =>
                    `평가 ${result.evaluationCount ?? 0}건 · 과업 ${result.taskCount ?? 0}건 · 평가입력 ${result.entryCount ?? 0}건`,
                )
              }
              className="w-full"
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportingKind === 'evaluations' ? '내보내는 중...' : '평가데이터 다운로드'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              전체 백업
            </CardTitle>
            <CardDescription>대상자 양식, 매칭 양식, 평가 상세 데이터를 한 파일로 묶습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                runExport(
                  'backup',
                  () => downloadHrBackupWorkbook({ includePastEvaluations }),
                  (result) =>
                    `대상자 ${result.targetCount ?? 0}명 · 매칭 ${result.matchingRowCount ?? 0}건 · 평가 ${result.evaluationCount ?? 0}건`,
                )
              }
              variant="outline"
              className="w-full"
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportingKind === 'backup' ? '내보내는 중...' : '전체 백업 다운로드'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
