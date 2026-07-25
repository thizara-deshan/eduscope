import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { ADMIN_USERS, type AdminUser } from '../../../mock/admin'
import { cn } from '../../ui/cn'

export function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>(ADMIN_USERS)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'User' | 'Admin'>('User')

  const addUser = () => {
    if (!name.trim() || !username.trim()) return
    setUsers((prev) => [...prev, { name: name.trim(), username: username.trim(), role }])
    setName('')
    setUsername('')
    setPassword('')
    setRole('User')
  }

  return (
    <>
      <div className="us-adm__cols">
        <section className="us-adm__card">
          <h2 className="us-adm__cardtitle">Add Single User</h2>
          <input className="us-input" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="us-input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="us-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className="us-select" value={role} onChange={(e) => setRole(e.target.value as 'User' | 'Admin')} aria-label="Role">
            <option value="User">Lecturer (User)</option>
            <option value="Admin">Administrator</option>
          </select>
          <button className="us-adm__primary us-adm__primary--block" onClick={addUser}>
            Add User
          </button>
        </section>

        <section className="us-adm__card">
          <h2 className="us-adm__cardtitle">Bulk Import Users</h2>
          <p className="us-adm__note">
            Upload a structured Excel sheet (.xlsx) to provision credentials in bulk.
          </p>
          <button className="us-adm__secondary us-adm__secondary--block">
            <FileSpreadsheet size={16} />
            Select Excel File (.xlsx)
          </button>
        </section>
      </div>

      <section className="us-adm__card">
        <h2 className="us-adm__cardtitle">User Directory</h2>
        <div className="us-adm__table">
          <div className="us-adm__trow us-adm__trow--head us-adm__trow--users">
            <span>Name</span>
            <span>Username</span>
            <span className="us-adm__tright">Role</span>
          </div>
          {users.map((u) => (
            <div key={u.username} className="us-adm__trow us-adm__trow--users">
              <span>{u.name}</span>
              <span className="us-adm__mono">{u.username}</span>
              <span className="us-adm__tright">
                <span className={cn('us-adm__chip', u.role === 'Admin' && 'us-adm__chip--admin')}>
                  {u.role}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
