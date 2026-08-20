import { useEffect, useMemo, useState } from 'react'
import { Button, Panel } from '../../shared/components'
import {
  addOrganizationMember,
  ApiError,
  getOrganizationMembers,
  revokeOrganizationMember,
  type OrganizationMember,
  updateOrganizationMemberRole,
} from '../../shared/lib/auth-api'

type MembersViewProps = {
  token: string
}

export function MembersView({ token }: MembersViewProps) {
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<'operator' | 'viewer'>('viewer')

  const canShowEmptyState = useMemo(() => !isLoading && members.length === 0 && !errorMessage, [
    errorMessage,
    isLoading,
    members.length,
  ])

  async function loadMembers() {
    setErrorMessage(null)
    setIsLoading(true)

    try {
      const response = await getOrganizationMembers(token)
      setMembers(response.members)
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo cargar la lista de miembros.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadMembers()
  }, [token])

  async function handleAddMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      await addOrganizationMember({ email, role: newRole }, token)
      setSuccessMessage('Miembro agregado correctamente.')
      setEmail('')
      setNewRole('viewer')
      await loadMembers()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo agregar el miembro.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleChangeRole(member: OrganizationMember, role: 'admin' | 'operator' | 'viewer') {
    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingMemberId(member.userId)

    try {
      await updateOrganizationMemberRole({ userId: member.userId, role }, token)
      setSuccessMessage('Rol actualizado correctamente.')
      await loadMembers()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar el rol del miembro.')
      }
    } finally {
      setPendingMemberId(null)
    }
  }

  async function handleRevokeMember(member: OrganizationMember) {
    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingMemberId(member.userId)

    try {
      await revokeOrganizationMember(member.userId, token)
      setSuccessMessage('Membresía revocada correctamente.')
      await loadMembers()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo revocar la membresía.')
      }
    } finally {
      setPendingMemberId(null)
    }
  }

  return (
    <main className="page members-page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Miembros</h1>
          <p>Gestioná roles y accesos de la organización activa.</p>
        </div>
      </div>

      <Panel className="members-panel" title="Agregar miembro existente">
        <form className="members-form" onSubmit={handleAddMember}>
          <label className="field">
            Email
            <input
              type="email"
              placeholder="persona@negocio.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>
          <label className="field">
            Rol
            <select
              className="select-input"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as 'operator' | 'viewer')}
              disabled={isSubmitting}
            >
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Agregando...' : 'Agregar miembro'}
          </Button>
        </form>
      </Panel>

      <Panel className="members-panel" title="Miembros de la organización">
        {isLoading ? <p>Cargando miembros...</p> : null}
        {canShowEmptyState ? <p>No hay miembros cargados para esta organización.</p> : null}

        {!isLoading && members.length > 0 ? (
          <table className="members-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const roleOptions = [member.role, ...member.actions.assignableRoles].filter(
                  (role, index, array) => array.indexOf(role) === index,
                )

                return (
                  <tr key={member.userId}>
                    <td>{member.fullName}</td>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                    <td className="members-table__actions">
                      <select
                        className="select-input"
                        value={member.role}
                        disabled={!member.actions.canChangeRole || pendingMemberId === member.userId}
                        onChange={(event) =>
                          void handleChangeRole(
                            member,
                            event.target.value as 'admin' | 'operator' | 'viewer',
                          )
                        }
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!member.actions.canRevoke || pendingMemberId === member.userId}
                        onClick={() => void handleRevokeMember(member)}
                      >
                        Revocar
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : null}
      </Panel>

      {errorMessage ? (
        <p className="members-message members-message--error" role="alert" aria-live="polite">
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="members-message members-message--success" role="status" aria-live="polite">
          {successMessage}
        </p>
      ) : null}
    </main>
  )
}
