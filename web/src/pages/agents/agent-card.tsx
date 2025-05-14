import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IFlow } from '@/interfaces/database/flow';
import { formatPureDate } from '@/utils/date';
import { ChevronRight, Share2, Trash2 } from 'lucide-react';

interface IProps {
  data: IFlow;
}

export function AgentCard({ data }: IProps) {
  const { navigateToAgent } = useNavigatePage();

  // 修改判断共享状态的逻辑，增加更多条件
  const isShared =
    data.permission === 'team' ||
    data.is_shared === true ||
    data.shared === true ||
    data.is_own === false || // 非自己创建的
    (data.nickname && data.nickname !== '') || // 有创建者昵称
    data.tenant_avatar || // 有租户头像
    typeof data.is_shared !== 'undefined'; // 字段存在即可能表示共享

  // 记录详细的调试信息
  console.log('助理数据:', data);
  console.log('是否共享:', isShared);
  console.log('权限值:', data.permission);
  console.log('是否自己的:', data.is_own);
  console.log('创建者昵称:', data.nickname);
  console.log('租户头像:', data.tenant_avatar);

  // 如果有创建者昵称，显示在共享标签中
  const creatorName = data.nickname || '团队成员';

  return (
    <Card className="bg-colors-background-inverse-weak border-colors-outline-neutral-standard">
      <CardContent className="p-4">
        <div className="flex justify-between mb-4">
          {data.avatar ? (
            <div
              className="w-[70px] h-[70px] rounded-xl bg-cover"
              style={{ backgroundImage: `url(${data.avatar})` }}
            />
          ) : (
            <Avatar className="w-[70px] h-[70px]">
              <AvatarImage src="https://github.com/shadcn.png" />
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          )}

          {/* 添加明显的共享图标 - 显示创建者信息 */}
          {isShared && (
            <div className="bg-blue-500 text-white px-2 py-1 rounded-md flex items-center text-sm">
              <Share2 className="h-3 w-3 mr-1" />
              <span>来自: {creatorName}</span>
            </div>
          )}
        </div>
        <h3 className="text-xl font-bold mb-2 flex items-center">
          {data.title}
          {/* 在标题旁边添加共享图标 */}
          {isShared && (
            <span className="ml-2 text-blue-500 flex items-center">
              <Share2 className="h-4 w-4" />
            </span>
          )}
        </h3>
        <p>An app that does things An app that does things</p>
        <section className="flex justify-between pt-3">
          <div>
            Search app
            <p className="text-sm opacity-80">
              {formatPureDate(data.update_time)}
              {/* 显示明显的共享文本 */}
              {isShared && (
                <span className="ml-2 text-blue-500 font-bold">已共享</span>
              )}
            </p>
          </div>
          <div className="space-x-2">
            <Button
              variant="icon"
              size="icon"
              onClick={navigateToAgent(data.id)}
            >
              <ChevronRight className="h-6 w-6" />
            </Button>
            <Button variant="icon" size="icon">
              <Trash2 />
            </Button>
            {/* 添加共享图标按钮 */}
            {isShared && (
              <Button
                variant="icon"
                size="icon"
                className="bg-blue-500 text-white hover:bg-blue-600"
              >
                <Share2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
