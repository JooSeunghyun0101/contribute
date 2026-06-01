import { useState } from 'react';
import { X } from 'lucide-react';
import EvaluatorPicker from '@/components/hr/EvaluatorPicker';
import type { Employee, UserRole } from '@/types';

export type NewEmployeeInput = {
  employee_id: string;
  name: string;
  position: string;
  department: string;
  job_role: string | null;
  growth_level: number | null;
  evaluator_id: string | null;
  available_roles: UserRole[];
};

interface Props {
  evaluatorOptions: Employee[];
  isSaving: boolean;
  onSubmit: (data: NewEmployeeInput) => void;
  onClose: () => void;
}

const ROLE_OPTIONS: { id: UserRole; label: string }[] = [
  { id: 'evaluatee', label: '피평가자' },
  { id: 'evaluator', label: '평가자' },
  { id: 'hr', label: 'HR' },
];

const AddEmployeeModal = ({ evaluatorOptions, isSaving, onSubmit, onClose }: Props) => {
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [growthLevel, setGrowthLevel] = useState('');
  const [evaluatorId, setEvaluatorId] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(['evaluatee']);

  const toggleRole = (role: UserRole) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const canSubmit =
    employeeId.trim().length > 0 &&
    name.trim().length > 0 &&
    roles.length > 0 &&
    !/^[A-Za-z]/.test(employeeId.trim());

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      employee_id: employeeId.trim(),
      name: name.trim(),
      position: position.trim() || '미지정',
      department: department.trim() || '미지정',
      job_role: jobRole.trim() || null,
      growth_level: growthLevel ? Number(growthLevel) : null,
      evaluator_id: evaluatorId || null,
      available_roles: roles,
    });
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--fs-xs)',
    fontWeight: 700,
    color: 'var(--fg-muted)',
    display: 'block',
    marginBottom: 6,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sd-card sd-card-lg"
        style={{ width: 'min(560px, 100%)', maxHeight: '88vh', overflow: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ fontSize: 'var(--fs-h3)', fontWeight: 900 }}>사용자 추가</h2>
          <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose} disabled={isSaving}>
            <X size={16} />
            닫기
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div>
            <label style={labelStyle}>사번 *</label>
            <input
              className="sd-input"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="예: 1411166"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>이름 *</label>
            <input
              className="sd-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>직급</label>
            <input
              className="sd-input"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>부서</label>
            <input
              className="sd-input"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>직무</label>
            <input
              className="sd-input"
              value={jobRole}
              onChange={(e) => setJobRole(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>성장레벨</label>
            <select
              className="sd-input"
              value={growthLevel}
              onChange={(e) => setGrowthLevel(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">해당없음</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>역할 *</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {ROLE_OPTIONS.map((role) => (
              <label
                key={role.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 700 }}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(role.id)}
                  onChange={() => toggleRole(role.id)}
                />
                {role.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>평가자 (선택)</label>
          <EvaluatorPicker
            options={evaluatorOptions}
            value={evaluatorId}
            onChange={setEvaluatorId}
            placeholder="이름·부서·사번으로 검색…"
            allowEmpty
            emptyLabel="평가자 없음"
            minWidth={240}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
          <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={onClose} disabled={isSaving}>
            취소
          </button>
          <button
            className="sd-btn sd-btn-primary sd-btn-sm"
            onClick={handleSubmit}
            disabled={!canSubmit || isSaving}
            title={
              employeeId.trim() && /^[A-Za-z]/.test(employeeId.trim())
                ? '사번은 영문자로 시작할 수 없습니다.'
                : undefined
            }
          >
            {isSaving ? '추가 중…' : '추가'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddEmployeeModal;
