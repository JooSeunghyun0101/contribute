import { memo } from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Pill } from '@/components/brand';
import { getOrgValue, orgFieldsFromEvaluation } from '@/lib/orgHierarchy';
import { isOnLeave } from '@/lib/employeeStatus';
import type { Employee, Evaluation, UserRole } from '@/types';
import {
  statusLabel,
  statusTone,
  roleLabel,
  ROLE_BG,
  ROLE_COLOR,
  ROLE_BORDER,
  editableRoleOptions,
  type EmployeeEditForm,
} from './_hrUsersHelpers';

// 묶어서 보기 그룹 헤더 행(메모) — 부모 map 에서 조건 렌더.
export const GroupHeaderRow = memo(function GroupHeaderRow({
  groupKey,
  count,
}: {
  groupKey: string;
  count: number;
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={14}
        style={{
          background: 'var(--bg-muted)',
          borderTop: '1px solid var(--border)',
          fontWeight: 700,
          color: 'var(--fg)',
        }}
      >
        {groupKey}
        <span style={{ marginLeft: 8, fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
          {count}명
        </span>
      </TableCell>
    </TableRow>
  );
});

export type UserRowProps = {
  employee: Employee;
  evaluation: Evaluation | null | undefined;
  evaluatorName: string;
  isSelected: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isCurrentOrgPeriod: boolean;
  editForm: EmployeeEditForm | null;
  onToggleSelect: (employeeId: string) => void;
  onStartEdit: (employee: Employee) => void;
  onCancelEdit: () => void;
  onSaveEdit: (employee: Employee) => void;
  onUpdateEditForm: <K extends keyof EmployeeEditForm>(key: K, value: EmployeeEditForm[K]) => void;
  onToggleEditRole: (role: UserRole) => void;
  onDelete: (employee: Employee) => void;
  onOpenHistory: (employeeId: string) => void;
  onOpenEvaluation: (employeeId: string) => void;
};

function UserRowInner({
  employee,
  evaluation,
  evaluatorName,
  isSelected,
  isEditing,
  isSaving,
  isDeleting,
  isCurrentOrgPeriod,
  editForm,
  onToggleSelect,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onUpdateEditForm,
  onToggleEditRole,
  onDelete,
  onOpenHistory,
  onOpenEvaluation,
}: UserRowProps) {
  const currentStatus = evaluation?.evaluation_status;
  const orgFields = orgFieldsFromEvaluation(evaluation, employee);
  const editing = isEditing && Boolean(editForm);
  // 성장레벨 배지는 '선택한 평가기간'의 스냅샷(evaluation.growth_level)을 보여준다.
  // employee.growth_level(현재·공유)을 쓰면 다른 연도 업로드로 바뀐 값이 지난 기간에도 보인다.
  const displayGrowthLevel =
    evaluation?.growth_level && evaluation.growth_level > 0
      ? evaluation.growth_level
      : employee.growth_level;

  return (
    <TableRow
      className={isSelected ? 'is-selected' : undefined}
      style={isSelected ? { background: 'var(--ok-orange-50)' } : undefined}
    >
      <TableCell>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(employee.employee_id)}
          aria-label={`${employee.name} 선택`}
        />
      </TableCell>
      <TableCell className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
        {employee.employee_id}
      </TableCell>
      <TableCell>
        {editing && editForm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              className="sd-input"
              value={editForm.name}
              onChange={(event) => onUpdateEditForm('name', event.target.value)}
              style={{ minWidth: 0 }}
            />
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--fs-xs)',
                color: editForm.onLeave ? 'var(--ok-brown)' : 'var(--fg-muted)',
                fontWeight: editForm.onLeave ? 700 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={editForm.onLeave}
                onChange={(event) => onUpdateEditForm('onLeave', event.target.checked)}
              />
              휴직 처리
            </label>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 'var(--fs-xs)',
                fontWeight: editForm.aiRuleExempt ? 700 : 600,
                color: editForm.aiRuleExempt ? 'var(--ok-brown)' : 'var(--fg-muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="체크 시 이 피평가자는 'AI 과업 가중치 50%' 규칙을 면제받아, 비중 미달이어도 성과보고 최종제출이 가능합니다."
            >
              <input
                type="checkbox"
                checked={editForm.aiRuleExempt}
                onChange={(event) => onUpdateEditForm('aiRuleExempt', event.target.checked)}
              />
              AI 50% 예외
            </label>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
            <div className="sd-avatar" style={{ width: 30, height: 30, fontSize: 'var(--fs-sm)' }}>
              {employee.name.charAt(0)}
            </div>
            <strong style={{ whiteSpace: 'nowrap' }}>{employee.name}</strong>
            {isOnLeave(employee) && (
              <span
                style={{
                  marginLeft: 6,
                  padding: '1px 7px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--bg-muted)',
                  color: 'var(--fg-muted)',
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 800,
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                }}
              >
                휴직
              </span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell style={{ whiteSpace: 'nowrap' }}>
        {editing && editForm ? (
          <input
            className="sd-input"
            value={editForm.position}
            onChange={(event) => onUpdateEditForm('position', event.target.value)}
            style={{ minWidth: 0 }}
          />
        ) : (
          employee.position
        )}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {editing && editForm && isCurrentOrgPeriod ? (
          <input
            className="sd-input"
            value={editForm.orgCorporation}
            onChange={(event) => onUpdateEditForm('orgCorporation', event.target.value)}
            style={{ minWidth: 0 }}
          />
        ) : (
          getOrgValue(orgFields, 'corporation') || '-'
        )}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {editing && editForm && isCurrentOrgPeriod ? (
          <input
            className="sd-input"
            value={editForm.orgDivision}
            onChange={(event) => onUpdateEditForm('orgDivision', event.target.value)}
            style={{ minWidth: 0 }}
          />
        ) : (
          getOrgValue(orgFields, 'division') || '-'
        )}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {editing && editForm && isCurrentOrgPeriod ? (
          <input
            className="sd-input"
            value={editForm.orgDepartment}
            onChange={(event) => onUpdateEditForm('orgDepartment', event.target.value)}
            style={{ minWidth: 0 }}
          />
        ) : (
          getOrgValue(orgFields, 'department') || '-'
        )}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {editing && editForm && isCurrentOrgPeriod ? (
          <input
            className="sd-input"
            value={editForm.orgTeam}
            onChange={(event) => onUpdateEditForm('orgTeam', event.target.value)}
            style={{ minWidth: 0 }}
          />
        ) : (
          getOrgValue(orgFields, 'team') || '-'
        )}
      </TableCell>
      <TableCell style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
        {editing && editForm ? (
          <input
            className="sd-input"
            value={editForm.jobRole}
            onChange={(event) => onUpdateEditForm('jobRole', event.target.value)}
            style={{ minWidth: 0 }}
          />
        ) : (
          employee.job_role ?? '-'
        )}
      </TableCell>
      <TableCell>
        {editing && editForm ? (
          <select
            className="sd-input"
            value={editForm.growthLevel}
            onChange={(event) => onUpdateEditForm('growthLevel', event.target.value)}
            style={{ width: 84 }}
          >
            <option value="">해당없음</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        ) : displayGrowthLevel ? (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--r-pill)',
              background: 'var(--bg-muted)',
              border: '1px solid var(--border)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
            }}
          >
            Lv.{displayGrowthLevel}
          </span>
        ) : (
          '-'
        )}
      </TableCell>
      <TableCell>
        {editing && editForm ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
            {editableRoleOptions.map((role) => (
              <label
                key={role.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={editForm.roles.includes(role.id)}
                  onChange={() => onToggleEditRole(role.id)}
                />
                {role.label}
              </label>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 4 }}>
            {employee.available_roles.map((role) => (
              <span
                key={role}
                style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--r-pill)',
                  background: ROLE_BG[role] ?? 'var(--bg-muted)',
                  color: ROLE_COLOR[role] ?? 'var(--fg)',
                  border: `1px solid ${ROLE_BORDER[role] ?? 'var(--border)'}`,
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {roleLabel(role as UserRole)}
              </span>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell style={{ color: editing ? 'var(--fg)' : 'var(--fg-muted)' }}>{evaluatorName}</TableCell>
      <TableCell style={{ whiteSpace: 'nowrap' }}>
        {/* F2-6: 선택 기간에 평가행이 없는 evaluatee 는 '기간 대상 아님'으로 구분 표시(표시만, 로직 불변). */}
        {!evaluation && employee.available_roles.includes('evaluatee') ? (
          <Pill tone="neutral">기간 대상 아님</Pill>
        ) : (
          <Pill tone={statusTone(currentStatus)}>{statusLabel(currentStatus)}</Pill>
        )}
      </TableCell>
      <TableCell
        className="text-right sticky-col"
        style={{
          position: 'sticky',
          right: 0,
          zIndex: 1,
          borderLeft: '1px solid var(--border)',
        }}
      >
        {editing ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="sd-btn sd-btn-primary sd-btn-sm"
              onClick={() => onSaveEdit(employee)}
              disabled={isSaving}
            >
              {isSaving ? '저장 중' : '저장'}
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onCancelEdit} disabled={isSaving}>
              취소
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              className="sd-btn sd-btn-ghost sd-btn-sm"
              onClick={() => onOpenEvaluation(employee.employee_id)}
              title="이 피평가자의 평가 내역(읽기 전용) 열람"
            >
              평가
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={() => onOpenHistory(employee.employee_id)}>
              이력
            </button>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={() => onStartEdit(employee)}>
              편집
            </button>
            <button
              className="sd-btn sd-btn-ghost sd-btn-sm"
              onClick={() => onDelete(employee)}
              disabled={isDeleting}
              style={{ color: 'var(--danger)' }}
            >
              {isDeleting ? '삭제 중' : '삭제'}
            </button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export const UserRow = memo(UserRowInner);
