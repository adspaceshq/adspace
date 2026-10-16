"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { UserLink } from "@/components/ui/UserLink";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { userErrorMessage } from "@/lib/errors";

// Admin-only: grant or remove reviewer/admin access. Roles are stored by account id, so a handle
// typed here is only a lookup. Members need a linked X account and a verified email.
export function TeamPanel() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ["admin", "team"], queryFn: () => api.admin.team() });
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<"reviewer" | "admin">("reviewer");
  const update = (members: Awaited<ReturnType<typeof api.admin.team>>) => queryClient.setQueryData(["admin", "team"], members);
  const add = useMutation({
    mutationFn: () => api.admin.addTeamMember(handle.trim(), role),
    onSuccess: (members) => {
      update(members);
      setHandle("");
    },
  });
  const [removing, setRemoving] = useState<{ userId: string; handle: string; role: string } | null>(null);
  const remove = useMutation({
    mutationFn: (userId: string) => api.admin.removeTeamMember(userId),
    onSuccess: (members) => {
      update(members);
      setRemoving(null);
    },
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <p className="text-body font-semibold">team</p>
        <p className="text-small text-muted">reviewers approve listings and resolve disputes; admins can also pause, change settings and manage the team. members need a linked X account and a verified email.</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (handle.trim()) add.mutate();
        }}
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-small font-medium">
          handle
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="@handle"
            autoCapitalize="none"
            spellCheck={false}
            className="h-10 rounded-control border border-line bg-surface px-3 text-body font-normal outline-none focus:border-line-strong"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          role
          <select value={role} onChange={(event) => setRole(event.target.value as "reviewer" | "admin")} className="h-10 rounded-control border border-line bg-surface px-3 text-body font-normal">
            <option value="reviewer">reviewer</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <Button type="submit" loading={add.isPending} disabled={!handle.trim()}>
          <UserPlus className="size-4" aria-hidden /> add
        </Button>
      </form>
      {add.isError && <p className="text-small text-danger">{userErrorMessage(add.error)}</p>}

      {team.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : !team.data?.length ? (
        <p className="text-small text-muted">no team members added yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {team.data.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-3 py-2.5 text-small">
              <SellerAvatar seller={{ handle: member.handle, displayName: member.displayName, avatarUrl: member.avatarUrl }} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.displayName}</p>
                <p className="truncate text-caption text-muted">
                  <UserLink handle={member.handle} />
                  {member.grantedByHandle && <> · added by <UserLink handle={member.grantedByHandle} /></>}
                  {member.grantedAt ? <> · {new Date(member.grantedAt).toLocaleDateString()}</> : <> · server settings</>}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${member.role === "reviewer" ? "bg-accent-soft text-accent" : "bg-ink text-white"}`}>{member.role}</span>
              {member.role !== "owner" && member.userId !== session?.id && (
                <button
                  type="button"
                  onClick={() => setRemoving({ userId: member.userId, handle: member.handle, role: member.role })}
                  disabled={remove.isPending}
                  aria-label={`remove @${member.handle}`}
                  className="cursor-pointer rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-danger"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={removing !== null}
        onClose={() => !remove.isPending && setRemoving(null)}
        title={removing ? `remove @${removing.handle}?` : "remove member"}
        description={removing ? `they lose ${removing.role} access right away. you can add them again later.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={remove.isPending}>
              cancel
            </Button>
            <Button variant="danger" onClick={() => removing && remove.mutate(removing.userId)} loading={remove.isPending}>
              remove
            </Button>
          </>
        }
      >
        {remove.isError ? <p className="text-small text-danger">{userErrorMessage(remove.error)}</p> : <p className="text-small text-muted">reviews and decisions they already made stay on record.</p>}
      </Modal>
    </Card>
  );
}
